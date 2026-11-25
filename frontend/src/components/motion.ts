import { gsap } from 'gsap'

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Groups whose items stagger in together, and marks that grow from their start.
const STAGGER = '.kcard, .kpi, .stat, .an-row, .an-tile, .an-emitter, .an-chip, .tile, .step, .stepper li, .approach, .list > li, .checklist__item'
const GROW_X = '.viz-stack, .an-bar'
const DRAW = '.donut__svg, .gauge__svg'
const COUNT = '.kcard__value, .kpi__value, .stat__value, .donut__value, .gauge__value, .an-tile__value'
const INNER = `${GROW_X}, ${DRAW}, ${COUNT}, .viz-line, .status--ok`

// Figures count up from zero, keeping their format (1,234.5 · 2.72k) and any unit after them.
function countUp(el: Element) {
  const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && /\d/.test(n.textContent ?? ''))
  const m = node?.textContent?.match(/^(\s*)([\d,]+(?:\.(\d+))?)(.*)$/s)
  if (!node || !m) return
  const target = Number(m[2].replace(/,/g, '')), dp = m[3]?.length ?? 0
  if (!target) return
  const v = { n: 0 }
  let written = node.textContent
  const tween = gsap.to(v, { n: target, duration: 1, delay: 0.1, ease: 'power2.out',
    onUpdate: () => {
      if (node.textContent !== written) { tween.kill(); return } // the page showed a new figure: leave it alone
      written = m[1] + v.n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }) + m[4]
      node.textContent = written
    },
    onComplete: () => { if (node.textContent === written) node.textContent = m[0] } })
}

// The trend line draws from left to right, then its fill fades in.
function drawLine(path: SVGPathElement) {
  const len = path.getTotalLength()
  if (!len) return
  gsap.fromTo(path, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut', clearProps: 'strokeDasharray,strokeDashoffset' })
  const area = path.parentElement?.querySelector('.viz-area')
  if (area) gsap.from(area, { opacity: 0, duration: 0.6, delay: 0.6, clearProps: 'opacity' })
}

// A success message pops in with a soft green glow.
function celebrate(el: Element) {
  gsap.fromTo(el, { scale: 0.97, opacity: 0, boxShadow: '0 0 0 0 rgb(21 128 61 / 0.35)' },
    { scale: 1, opacity: 1, boxShadow: '0 0 0 8px rgb(21 128 61 / 0)', duration: 0.6, ease: 'back.out(2)', clearProps: 'transform,opacity,boxShadow' })
}

function animateInner(el: Element) {
  if (el.matches(COUNT)) countUp(el)
  el.querySelectorAll(COUNT).forEach(countUp)
  if (el.matches('.status--ok')) celebrate(el)
  el.querySelectorAll('.status--ok').forEach(celebrate)
  if (el.matches('.viz-line')) drawLine(el as SVGPathElement)
  el.querySelectorAll<SVGPathElement>('.viz-line').forEach(drawLine)
}

// `self` false: the block is already visible inside a page that faded in as a whole, so only its parts animate.
function animate(el: Element, self = true) {
  if (!(el instanceof HTMLElement) || el.dataset.animated) return
  el.dataset.animated = '1'
  // Opacity only: content that arrives after loading fades in place, never slides, so nothing around it jumps.
  if (self) gsap.from(el, { opacity: 0, duration: 0.3, ease: 'power1.out', clearProps: 'opacity' })
  const items = el.matches(STAGGER) ? [] : [...el.querySelectorAll(STAGGER)]
  if (items.length) gsap.from(items, { opacity: 0, y: 6, duration: 0.3, stagger: 0.025, ease: 'power2.out', clearProps: 'transform,opacity' })
  const bars = el.querySelectorAll(GROW_X)
  if (bars.length) gsap.from(bars, { scaleX: 0, transformOrigin: 'left center', duration: 0.7, stagger: 0.03, delay: 0.15, ease: 'power3.out', clearProps: 'transform' })
  const rings = el.querySelectorAll(DRAW)
  if (rings.length) gsap.from(rings, { rotate: -90, scale: 0.85, opacity: 0, duration: 0.8, delay: 0.1, ease: 'back.out(1.4)', clearProps: 'transform,opacity' })
  animateInner(el)
}

// Animates each block as it appears in `root` (pages load their data after opening, so new blocks keep arriving).
export function revealIn(root: HTMLElement | null) {
  if (!root || reduced()) return () => {}
  // The page fades in as one piece (one smooth motion on every menu click), then its parts settle.
  gsap.killTweensOf(root)
  gsap.fromTo(root, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power1.out', clearProps: 'transform,opacity' })
  ;[...root.children].forEach((c) => animate(c, false))
  const obs = new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
    if (n instanceof Element && n.parentElement === root) animate(n)
    else if (n instanceof Element && (n.matches(STAGGER) || n.querySelector(GROW_X))) animate(n)
    else if (n instanceof Element && (n.matches(INNER) || n.querySelector(INNER))) animateInner(n)
  })))
  obs.observe(root, { childList: true, subtree: true })
  return () => obs.disconnect()
}

// Sidebar entries and top bar slide in once when the app opens.
export function introShell(root: HTMLElement | null) {
  if (!root || reduced()) return
  gsap.from(root.querySelectorAll('.topbar > *'), { y: -8, opacity: 0, duration: 0.4, stagger: 0.05, ease: 'power2.out', clearProps: 'transform,opacity' })
  gsap.from(root.querySelectorAll('.sidebar .nav-link, .sidebar__label'), { x: -10, opacity: 0, duration: 0.35, stagger: 0.015, delay: 0.1, ease: 'power2.out', clearProps: 'transform,opacity' })
}

// After a tab switch, the content below the tab row fades in instead of swapping abruptly.
export function fadeAfter(tabRow: HTMLElement | null) {
  if (!tabRow || reduced()) return
  const next: Element[] = []
  for (let el = tabRow.nextElementSibling; el; el = el.nextElementSibling) next.push(el)
  const parent = tabRow.parentElement
  if (!next.length && parent) for (let el = parent.nextElementSibling; el; el = el.nextElementSibling) next.push(el)
  if (next.length) gsap.fromTo(next, { opacity: 0.35, y: 6 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'transform,opacity' })
}
