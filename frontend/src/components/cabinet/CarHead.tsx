import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { SHORT } from "@/lib/constants";
import { carTone, ownerKindLabel } from "@/lib/format";
import { NavLink, type Route } from "@/lib/nav";
import type { Car } from "@/lib/types";

export function CarHead({ car, backRoute, backLabel }: { car: Car; backRoute: Route; backLabel: string }) {
  return (
    <>
      <NavLink route={backRoute} className="back">
        <Icon name="back" />
        {backLabel}
      </NavLink>
      <header className="head" style={{ alignItems: "flex-start" }}>
        <div>
          <h1 className="large-title">{car.title}</h1>
          <div className="meta">
            <span className="mono">{car.vin ? "VIN " + car.vin : "VIN не заполнен"}</span>
            <span>
              {`${ownerKindLabel(car.owner.type)} · ${car.owner.name}`}
            </span>
          </div>
        </div>
        <Badge text={SHORT[car.step - 1]} tone={carTone(car)} />
      </header>
    </>
  );
}
