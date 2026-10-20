import type { CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import { GALLERY } from "@/lib/constants";

export function GallerySection() {
  return (
    <section id="cars">
      <div className="in">
        <div className="sec-head">
          <span className="eyebrow">Привезённые машины</span>
          <h2>Уже у владельцев</h2>
          <p className="lead">
            Сюда встанут фото выданных машин. <span className="todo">Нужны ваши фото</span>
          </p>
        </div>
        <div className="gallery">
          {GALLERY.map(([name, year, tint]) => (
            <figure className="card shot" key={name}>
              <div className="pic" style={{ "--tint": tint } as CSSProperties}>
                <span className="phl">
                  <Icon name="photo" />
                  Фото
                </span>
              </div>
              <figcaption className="cap2">
                <span className="headline">
                  {`${name}, ${year}`}
                </span>
                <span className="sub muted">
                  Срок: <span className="todo">указать</span> · Город: <span className="todo">указать</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
