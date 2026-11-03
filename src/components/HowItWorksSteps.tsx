"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { BadgeBrowse, BadgeCalendar, BadgeLock, BadgeTruck } from "@/components/AnimatedIcons";
import { IconArrowRight } from "@/components/icons";
import styles from "./HowItWorksSteps.module.css";

const steps = [
  {
    number: "01",
    phrase: "Find the right frame.",
    title: "Choose your kit",
    copy: "Match cameras, lenses, lighting and sound to the shot you want.",
    icon: BadgeBrowse,
    imagePosition: "18% 0%",
  },
  {
    number: "02",
    phrase: "A plan that fits.",
    title: "Set your dates",
    copy: "Choose your rental window and see the price before you book.",
    icon: BadgeCalendar,
    imagePosition: "82% 0%",
  },
  {
    number: "03",
    phrase: "Lock in the details.",
    title: "Book with confidence",
    copy: "Confirm securely online. We’ll check your kit and get it ready.",
    icon: BadgeLock,
    imagePosition: "18% 100%",
  },
  {
    number: "04",
    phrase: "Ready when action calls.",
    title: "Collect. Shoot. Return.",
    copy: "Collect in central London or arrange delivery across London.",
    icon: BadgeTruck,
    imagePosition: "82% 100%",
  },
];

export function HowItWorksSteps() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % steps.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="section-window px-6 py-20" aria-labelledby="how-it-works-heading">
      <div className="mx-auto max-w-7xl">
        <Reveal className="text-center">
          <div className="hud-label !text-accent-400/90">How it works</div>
          <h2 id="how-it-works-heading" className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
            On set in <span className="serif-accent gradient-text text-[1.06em]">four steps</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-white/50">
            From the first shortlist to the first take, your kit is sorted.
          </p>
        </Reveal>
        <div className={styles.grid} aria-label="Four steps to rent cinema gear">
          {steps.map((step, index) => {
            const StepIcon = step.icon;
            return (
              <Reveal key={step.number} delay={index * 80} className={styles.item}>
                <article
                  className={styles.card}
                  data-active={activeStep === index}
                  tabIndex={0}
                  aria-label={`Step ${step.number}: ${step.title}`}
                  onMouseEnter={() => setActiveStep(index)}
                  onFocus={() => setActiveStep(index)}
                >
                  <div
                    className={styles.image}
                    style={{ backgroundPosition: step.imagePosition }}
                    aria-hidden="true"
                  />
                  <div className={styles.scrim} aria-hidden="true" />
                  <div className={styles.topline}>
                    <span className={styles.number}>{step.number}</span>
                    <span className={styles.glyph} aria-hidden="true">
                      <StepIcon className={styles.glyphIcon} />
                    </span>
                  </div>
                  <div className={styles.copy}>
                    <span className={styles.phrase}>{step.phrase}</span>
                    <h3>{step.title}</h3>
                    <p>{step.copy}</p>
                  </div>
                  <div className={styles.progress} aria-hidden="true"><span /></div>
                </article>
                {index < steps.length - 1 && (
                  <div className={styles.connector} data-active={activeStep === index} aria-hidden="true">
                    <IconArrowRight />
                  </div>
                )}
              </Reveal>
            );
          })}
        </div>
        <Reveal className="mt-8 text-center">
          <Link href="/how-it-works" className="arrow-link inline-flex min-h-[40px] items-center text-sm text-accent-400 transition-colors hover:text-accent-300">
            See the full rental process <span className="arrow">→</span>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
