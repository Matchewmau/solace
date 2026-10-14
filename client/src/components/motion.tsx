import { MotionConfig, motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

/**
 * Brand-quiet motion primitives for non-POS routes ONLY.
 *
 * POS stays boring and instant: PosPage, store/orders, api/*,
 * lib/formatPeso, and lib/sortCategories must NEVER import this
 * module (source-grep enforced).
 *
 * All animation is opacity + small y-transform tweens (no springs,
 * no size changes) so there is no layout shift. Reduced-motion
 * users get instant content via MotionConfig reducedMotion="user".
 */

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: "easeOut" },
  },
};

/** Fade-slide entrance for page headers and sections. */
export function Reveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.section
        className={className}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        {children}
      </motion.section>
    </MotionConfig>
  );
}

/** Stagger container for section groups (renders a div). */
export function StaggerGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className={className}
        variants={listVariants}
        initial="hidden"
        animate="show"
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}

/** Stagger child section (renders a section). Must sit in StaggerGroup. */
export function StaggerSection({
  children,
  className,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <motion.section
      className={className}
      aria-label={ariaLabel}
      variants={itemVariants}
    >
      {children}
    </motion.section>
  );
}

/** Staggered list container (renders a ul). Pair with StaggerItem. */
export function StaggerList({
  children,
  className,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.ul
        className={className}
        aria-label={ariaLabel}
        variants={listVariants}
        initial="hidden"
        animate="show"
      >
        {children}
      </motion.ul>
    </MotionConfig>
  );
}

/** Staggered list item (renders an li). Must be inside StaggerList. */
export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.li className={className} variants={itemVariants}>
      {children}
    </motion.li>
  );
}
