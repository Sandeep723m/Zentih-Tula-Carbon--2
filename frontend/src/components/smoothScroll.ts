import Lenis from 'lenis'
import { gsap } from 'gsap'

let lenis: Lenis | null = null

// Smooth wheel and trackpad scrolling for the whole page, driven by GSAP's clock so scroll and animations stay in step.
// Inner scroll areas (sidebar, wide tables, dropdowns, dialogs) keep native scrolling. Off when the person prefers reduced motion.
export function startSmoothScroll() {
  if (lenis || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    // Only areas that scroll vertically on their own; tables and tab rows scroll sideways, so the page stays smooth over them.
    prevent: (node) => !!node.closest('.sidebar, .ss__list, .picker__list, .usermenu__panel, dialog, textarea, [data-lenis-prevent]'),
  })
  gsap.ticker.add((time) => lenis?.raf(time * 1000))
  gsap.ticker.lagSmoothing(0)
}

// Jump (new page) or glide (in-page link) to a position or element, through Lenis when it is running.
export function scrollToTarget(target: number | HTMLElement, smooth = false) {
  if (lenis) lenis.scrollTo(target, { immediate: !smooth, offset: typeof target === 'number' ? 0 : -80 })
  else if (typeof target === 'number') window.scrollTo(0, target)
  else target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
}
