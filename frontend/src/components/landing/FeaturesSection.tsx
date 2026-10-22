import { Badge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Progress } from "@/components/ui/Progress";

export function FeaturesSection() {
  return (
    <section className="band">
      <div className="in">
        <div className="sec-head">
          <span className="eyebrow">Личный кабинет</span>
          <h2>Что вы видите после входа</h2>
        </div>
        <div className="feats">
          <div className="card feat" style={{ background: "var(--bg-elevated)" }}>
            <div className="ui">
              <div className="mini">
                <div className="top">
                  <span className="headline">Zeekr 001, 2025</span>
                  <Badge text="В пути по Китаю" tone="accent" />
                </div>
                <Progress step={5} caption="Обновлено 25.09" />
              </div>
            </div>
            <div className="tx">
              <span className="title-3">Прогресс по каждой машине</span>
              <span className="sub muted">Текущий этап из 13 виден сразу в списке, без звонков менеджеру.</span>
            </div>
          </div>
          <div className="card feat" style={{ background: "var(--bg-elevated)" }}>
            <div className="ui">
              <div className="mrow">
                <span className="dot d">
                  <Icon name="check" />
                </span>
                <span>Выкуплен</span>
                <Chip file={{ kind: "photo", label: "Фото · 4" }} />
              </div>
              <div className="mrow">
                <span className="dot d">
                  <Icon name="check" />
                </span>
                <span>В ТК в Китае</span>
                <Chip file={{ kind: "video", label: "Видео" }} />
              </div>
              <div className="mrow">
                <span className="dot d">
                  <Icon name="check" />
                </span>
                <span>Прибыла в РФ</span>
                <Chip file={{ kind: "file", label: "Декларация.pdf" }} />
              </div>
            </div>
            <div className="tx">
              <span className="title-3">Фото, видео и документы</span>
              <span className="sub muted">Вложения лежат прямо в карточке машины, по шагам.</span>
            </div>
          </div>
          <div className="card feat" style={{ background: "var(--bg-elevated)" }}>
            <div className="ui">
              <span className="mb">Нашли два варианта, скидываю фото.</span>
              <span className="mb me">Нужен именно 2023 год.</span>
              <span className="mb">Второй вариант 2023, берём?</span>
            </div>
            <div className="tx">
              <span className="title-3">Диалог по заявке</span>
              <span className="sub muted">Варианты, уточнения и согласование в одном месте.</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
