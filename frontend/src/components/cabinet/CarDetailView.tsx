"use client";

import { Progress } from "@/components/ui/Progress";
import { LoadError, Loading } from "@/components/ui/QueryState";
import { ApiError } from "@/lib/api/client";
import { useRequest, useVehicle } from "@/lib/api/queries";
import { FULL, KIND, KIND_WORD, SHORT } from "@/lib/constants";
import { dateFull, dateShort } from "@/lib/format";
import { NavLink, useRedirectWhen } from "@/lib/nav";
import { useRole } from "@/lib/session";
import { CarHead } from "./CarHead";
import { NotifyPanel } from "./NotifyPanel";
import { Timeline } from "./Timeline";

function RequestLink({ requestId }: { requestId: string }) {
  const { data } = useRequest(requestId);
  return (
    <NavLink route="request" id={requestId} className="row">
      <div className="main">
        <span>Диалог по заявке</span>
        <span className="sub muted">{data ? `Заявка от ${dateFull(data.createdAt)}` : "Заявка"}</span>
      </div>
      <span className="chev" aria-hidden="true"></span>
    </NavLink>
  );
}

export function CarDetailView({ id }: { id: string }) {
  const role = useRole();
  const { data: c, error, refetch } = useVehicle(id);
  const denied = error instanceof ApiError && (error.status === 404 || error.status === 403);
  useRedirectWhen(denied, "/cars");
  if (denied) return null;
  if (error && !c) return <LoadError error={error} retry={() => void refetch()} />;
  if (!c) return <Loading />;

  const step = c.currentStep;
  const k = KIND[step - 1];
  const waitingWord = c.awaitingAttachment && step < 13 && k !== "none" ? KIND_WORD[k] : null;

  return (
    <>
      <CarHead car={c} backRoute="cars" backLabel={role === "person" ? "Мои машины" : "Заказанные машины"} />
      <div className="split">
        <section className="card grow">
          <Timeline car={c} />
        </section>
        <aside>
          <section className="card panel">
            <h2 className="title-3">Прогресс</h2>
            <Progress step={step} caption={SHORT[step - 1]} />
            <p className="sub muted">
              {step === 13
                ? "Машина готова к выдаче. Документы СБКТС и ЭПТС получены."
                : waitingWord
                  ? "Менеджер прикрепит " + waitingWord + " по текущему этапу — вы увидите его здесь."
                  : "Следующий этап — «" + FULL[step] + "»."}
            </p>
          </section>
          {role === "picker" && <NotifyPanel car={c} />}
          <section className="group">
            <div className="row">
              <div className="main">Заказ создан</div>
              <span className="val">{dateFull(c.createdAt)}</span>
            </div>
            <div className="row">
              <div className="main">Обновлено</div>
              <span className="val">{dateShort(c.updatedAt)}</span>
            </div>
            <div className="row">
              <div className="main">Вложений</div>
              <span className="val">{c.attachmentsCount}</span>
            </div>
            {c.requestId && <RequestLink requestId={c.requestId} />}
          </section>
        </aside>
      </div>
    </>
  );
}
