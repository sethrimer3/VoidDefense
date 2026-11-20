/**
 * Scroll arrows in place of scrollbars: the menus listed in SCROLLERS hide
 * their scrollbars, and a small pixel arrow shows at the top middle while there
 * is more above, at the bottom middle while there is more below (left and right
 * middle for a row that scrolls sideways).
 *
 * Each arrow is a sibling of its menu, placed over the menu's edge in the
 * menu's containing block, so menus whose parents redraw get fresh arrows, and
 * nothing inside a menu (a grid or a flex column) gains extra items.
 */

/** The menus that scroll with arrows instead of scrollbars. */
export const SCROLLERS = "[data-pal-drawer], .void-building-panel";
/** Menus among them that scroll sideways. */
const SIDEWAYS = ".void-scroll-sideways";
/** How far in from the menu's edge an arrow sits, in CSS pixels. */
const INSET = 3;

type Arrows = {
  menu: HTMLElement;
  back: HTMLElement;
  on: HTMLElement;
  fixed: boolean;
  sideways: boolean;
  queued: boolean;
};
const tracked = new WeakMap<HTMLElement, Arrows>();

function arrow(dir: string): HTMLElement {
  const a = document.createElement("div");
  a.className = `scroll-arrow scroll-arrow-${dir}`;
  a.setAttribute("aria-hidden", "true");
  return a;
}

/** Where the menu's box lies inside an arrow's containing block. */
function boxIn(menu: HTMLElement, a: HTMLElement) {
  const r = menu.getBoundingClientRect();
  const cb = a.offsetParent as HTMLElement | null;
  if (!cb) return { left: r.left, top: r.top, width: r.width, height: r.height };
  const c = cb.getBoundingClientRect();
  return {
    left: r.left - c.left - cb.clientLeft + cb.scrollLeft,
    top: r.top - c.top - cb.clientTop + cb.scrollTop,
    width: r.width,
    height: r.height,
  };
}

function update(t: Arrows) {
  t.queued = false;
  const { menu, back, on } = t;
  if (!menu.isConnected) return;
  const sideways =
    t.fixed || menu.scrollWidth - menu.clientWidth > Math.max(1, menu.scrollHeight - menu.clientHeight);
  if (sideways !== t.sideways) {
    t.sideways = sideways;
    back.className = `scroll-arrow scroll-arrow-${sideways ? "left" : "up"}`;
    on.className = `scroll-arrow scroll-arrow-${sideways ? "right" : "down"}`;
  }
  const parent = menu.parentElement;
  if (!parent) return;
  for (const a of [back, on]) {
    if (a.parentElement !== parent) parent.appendChild(a);
  }
  const shown = menu.offsetWidth > 0 && menu.offsetHeight > 0;
  const pos = sideways ? menu.scrollLeft : menu.scrollTop;
  const view = sideways ? menu.clientWidth : menu.clientHeight;
  const size = sideways ? menu.scrollWidth : menu.scrollHeight;
  back.classList.toggle("show", shown && pos > 1);
  on.classList.toggle("show", shown && pos + view < size - 1);
  if (!shown) return;
  const box = boxIn(menu, back);
  if (sideways) {
    const mid = `${box.top + box.height / 2}px`;
    back.style.top = on.style.top = mid;
    back.style.left = `${box.left + INSET}px`;
    on.style.left = `${box.left + box.width - INSET}px`;
  } else {
    const mid = `${box.left + box.width / 2}px`;
    back.style.left = on.style.left = mid;
    back.style.top = `${box.top + INSET}px`;
    on.style.top = `${box.top + box.height - INSET}px`;
  }
}

function queue(t: Arrows) {
  if (t.queued) return;
  t.queued = true;
  requestAnimationFrame(() => update(t));
}

function track(menu: HTMLElement) {
  const sideways = menu.matches(SIDEWAYS);
  const t: Arrows = {
    menu,
    fixed: sideways,
    sideways,
    queued: false,
    back: arrow(sideways ? "left" : "up"),
    on: arrow(sideways ? "right" : "down"),
  };
  tracked.set(menu, t);
  const again = () => queue(t);
  menu.addEventListener("scroll", again, { passive: true });
  menu.addEventListener(
    "wheel",
    (e) => {
      if (!t.sideways || e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const room = menu.scrollWidth - menu.clientWidth;
      if (room <= 1 || (e.deltaY < 0 && menu.scrollLeft <= 0) || (e.deltaY > 0 && menu.scrollLeft >= room - 1)) return;
      e.preventDefault();
      menu.scrollLeft += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    },
    { passive: false },
  );
  const step = (dir: number) => (e: Event) => {
    e.preventDefault();
    if (t.sideways) {
      menu.scrollBy({ left: dir * Math.max(80, menu.clientWidth * 0.8), behavior: "smooth" });
    } else {
      menu.scrollBy({ top: dir * Math.max(80, menu.clientHeight * 0.8), behavior: "smooth" });
    }
  };
  t.back.addEventListener("click", step(-1));
  t.on.addEventListener("click", step(1));
  const sizes = new ResizeObserver(again);
  sizes.observe(menu);
  if (menu.parentElement) sizes.observe(menu.parentElement);
  new MutationObserver(again).observe(menu, { childList: true, subtree: true });
  update(t);
}

/** Watches the page for the menus, adding arrows to each as it appears. */
export function installScrollArrows(root: HTMLElement = document.body) {
  let pending = false;
  const scan = () => {
    pending = false;
    for (const menu of Array.from(root.querySelectorAll(SCROLLERS)) as HTMLElement[]) {
      const t = tracked.get(menu);
      if (!t) track(menu);
      else if (t.back.parentElement !== menu.parentElement) queue(t);
    }
  };
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(scan);
  }).observe(root, { childList: true, subtree: true });
  const all = () => {
    for (const menu of Array.from(root.querySelectorAll(SCROLLERS)) as HTMLElement[]) {
      const t = tracked.get(menu);
      if (t) queue(t);
    }
  };
  root.addEventListener("transitionend", all);
  window.addEventListener("resize", all);
  scan();
}
