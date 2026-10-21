-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "awaitingReply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastMessageAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Request_awaitingReply_lastMessageAt_idx" ON "Request"("awaitingReply", "lastMessageAt");

-- Вручную (Prisma не умеет триггеры): производные поля очереди ведёт БД, поэтому они верны
-- при любом пути записи (API, миграции, ручные правки) и не расходятся с сообщениями.
--
-- Пересчёт по последнему сообщению диалога: «ждёт ответа» — заявка открыта (NEW / IN_DIALOG), и
-- либо сообщений ещё нет, либо последнее написал клиент (у системных сообщений автора нет,
-- сообщения менеджера пишет пользователь с ролью ADMIN).
CREATE FUNCTION "refresh_request_activity"(req uuid) RETURNS void AS $$
DECLARE
  last_at timestamp(3);
  last_author uuid;
  last_by_admin boolean;
  has_message boolean;
BEGIN
  SELECT m."createdAt", m."authorId", COALESCE(u."role" = 'ADMIN', false)
    INTO last_at, last_author, last_by_admin
    FROM "Message" m
    LEFT JOIN "User" u ON u."id" = m."authorId"
   WHERE m."requestId" = req
   ORDER BY m."createdAt" DESC, m."id" DESC
   LIMIT 1;
  has_message := FOUND;

  UPDATE "Request" r
     SET "lastMessageAt" = last_at,
         "awaitingReply" = r."status" IN ('NEW', 'IN_DIALOG')
           AND (NOT has_message OR (last_author IS NOT NULL AND NOT last_by_admin))
   WHERE r."id" = req;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "message_changed_activity"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "refresh_request_activity"(OLD."requestId");
    RETURN OLD;
  END IF;
  PERFORM "refresh_request_activity"(NEW."requestId");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Message_activity"
  AFTER INSERT OR DELETE ON "Message"
  FOR EACH ROW EXECUTE FUNCTION "message_changed_activity"();

-- Закрытая заявка (одобрена или отклонена) никого не ждёт
CREATE FUNCTION "request_closed_activity"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('APPROVED', 'REJECTED') THEN
    NEW."awaitingReply" := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Request_closed_activity"
  BEFORE UPDATE OF "status" ON "Request"
  FOR EACH ROW EXECUTE FUNCTION "request_closed_activity"();

-- Данные, созданные до этой миграции
SELECT "refresh_request_activity"("id") FROM "Request";
