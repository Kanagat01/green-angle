-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'SYSTEM';

-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "authorId" DROP NOT NULL;

-- Вручную (Prisma не умеет CHECK): автора нет ровно у служебных сообщений.
-- Сравнение через ::text: новое значение enum нельзя использовать в той же транзакции, где оно добавлено.
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_author_required_unless_system"
  CHECK (("type"::text = 'SYSTEM') = ("authorId" IS NULL));
