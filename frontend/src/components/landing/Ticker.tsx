"use client";

import { SHORT } from "@/lib/constants";
import { useApp } from "@/lib/store";

export function Ticker() {
  const { db } = useApp();
  return (
    <div className="ticker">
      <div className="in">
        <span className="lbl">
          <span>Сейчас в работе</span> (демо)
        </span>
        <div className="win">
          <div className="run">
            {[0, 1, 2, 3].flatMap((k) =>
              db.cars.map((c) => (
                <span className="it" key={k + c.id}>
                  <b>{c.title}</b>
                  <span>
                    {`${SHORT[c.step - 1]} · этап ${c.step} из 13`}
                  </span>
                </span>
              )),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
