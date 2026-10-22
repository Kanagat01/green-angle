"use client";

import { defaultRoute, routePath, useRedirectWhen } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { AboutSection } from "./AboutSection";
import { FaqSection } from "./FaqSection";
import { FeaturesSection } from "./FeaturesSection";
import { FinalSection } from "./FinalSection";
import { GallerySection } from "./GallerySection";
import { Hero } from "./Hero";
import { HowSection } from "./HowSection";
import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";
import { RouteSection } from "./RouteSection";
import { Ticker } from "./Ticker";

/** Главная: лендинг для гостя. Вошедший пользователь сразу уходит в свой кабинет. */
export function Landing() {
  const session = useSession();
  const target = session.status === "authed" ? routePath(defaultRoute(session.role), undefined, session.role) : "/";
  const inside = session.status === "authed";
  useRedirectWhen(inside, target);
  if (inside) return null;

  return (
    <div id="landing">
      <div className="lp">
        <LandingNav />
        <Hero />
        <Ticker />
        <HowSection />
        <RouteSection />
        <FeaturesSection />
        <GallerySection />
        <AboutSection />
        <FaqSection />
        <FinalSection />
        <LandingFooter />
      </div>
    </div>
  );
}
