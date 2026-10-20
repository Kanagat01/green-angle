"use client";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Progress } from "@/components/ui/Progress";
import { openModal } from "@/lib/store";
import { VinCheck } from "./VinCheck";

export function Hero() {
  return (
    <section className="hero">
      <div className="in">
        <div className="txt">
          <div className="who">
            <span className="pill">Компаниям по привозу</span>
            <span className="pill">Частным покупателям</span>
          </div>
          <h1>
            Машина из Китая. <em>Каждый этап</em> у вас на экране.
          </h1>
          <p className="lead">
            Оставляете заявку, согласуете вариант с менеджером и следите за машиной по 13 статусам: от оплаты до выдачи с ЭПТС.
            Каждый важный шаг подтверждён фото, видео или документом.
          </p>
          <div className="cta">
            <button type="button" className="btn btn-filled" onClick={() => openModal({ kind: "register", type: "picker" })}>
              Оставить заявку
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => openModal({ kind: "login", staff: false })}>
              Войти в кабинет
            </button>
          </div>
          <VinCheck />
        </div>
        <div className="scene" aria-hidden="true">
          <div className="panel phbox">
            <span className="phl">
              <Icon name="photo" />
              Фото
            </span>
          </div>
          <div className="float f-status">
            <div className="top">
              <div className="stack">
                <span className="headline">Geely Monjaro, 2024</span>
                <span className="mono cap muted">VIN LVSHCAMB5RE077734</span>
              </div>
              <Badge text="Прибыла на СВХ" tone="warning" />
            </div>
            <Progress step={9} caption="Обновлено сегодня" />
          </div>
          <div className="float f-photo">
            <span className="ic">
              <Icon name="photo" />
            </span>
            <span className="stack">
              <b>Фото со склада</b>
              <span className="cap muted">6 снимков · шаг 6</span>
            </span>
          </div>
          <div className="float f-chat">
            <span className="who">Менеджер</span>
            Нашли два варианта, скидываю фото и ссылки.
          </div>
        </div>
      </div>
    </section>
  );
}
