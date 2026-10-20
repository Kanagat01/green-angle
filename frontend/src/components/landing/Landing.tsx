"use client";

import { defaultRoute, routePath, useRedirectWhen } from "@/lib/nav";
import { useApp } from "@/lib/store";
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
  const { ready, authed, role } = useApp();
  const inside = ready && authed;
  useRedirectWhen(inside, routePath(defaultRoute(role), undefined, role));
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
