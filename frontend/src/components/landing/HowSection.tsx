import { Icon, LandingIcon } from "@/components/ui/Icon";

export function HowSection() {
  return (
    <section id="how" className="band">
      <div className="in">
        <div className="sec-head">
          <span className="eyebrow">Как это работает</span>
          <h2>От заявки до ключей без переписки в пяти мессенджерах</h2>
          <p className="lead">Один кабинет, где видно всё по вашей машине.</p>
        </div>
        <ol className="how">
          <li>
            <span className="ic">
              <LandingIcon name="doc" />
            </span>
            <span className="headline">Заявка</span>
            <span className="sub muted">Марка и модель, год, бюджет и пожелания по комплектации.</span>
          </li>
          <li>
            <span className="ic">
              <Icon name="chat" />
            </span>
            <span className="headline">Диалог с менеджером</span>
            <span className="sub muted">Менеджер присылает варианты с фото и ссылками, вы уточняете детали.</span>
          </li>
          <li>
            <span className="ic">
              <LandingIcon name="ok" />
            </span>
            <span className="headline">Заказ</span>
            <span className="sub muted">Согласованный вариант становится заказом и появляется в вашем кабинете.</span>
          </li>
          <li>
            <span className="ic">
              <Icon name="car" />
            </span>
            <span className="headline">13 этапов до выдачи</span>
            <span className="sub muted">Оплата, выкуп, дорога по Китаю, граница, таможня, ЭПТС и СБКТС.</span>
          </li>
        </ol>
      </div>
    </section>
  );
}
