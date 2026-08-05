"use client";

import { motion } from "motion/react";
import { usePathname } from "next/navigation";
import { motionTokens } from "@/lib/motion-tokens";

// Ported: a simple opacity fade keyed on the route. Opacity only — a
// transform here would break position:fixed children and adds nothing.
export function MemberPageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
    >
      {children}
    </motion.div>
  );
}
