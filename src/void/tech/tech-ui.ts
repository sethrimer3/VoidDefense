/** Single global elastic technology network UI for Void Defense.
 * Reuses `UpgradeGraph` (`src/ui/upgrade-graph.ts`), `MagicCircle`, and icon
 * painters while presenting all 6 Resistance sectors on one zoomable/pannable
 * screen with multi-parent cross-links and full no-fee respec. */

import { MagicCircle } from "../../magic-circle/render.ts";
import { paintPathIcon, type PathHue, type PathIcon } from "../../ui/path-icons.ts";
import { UpgradeGraph, type GraphNode } from "../../ui/upgrade-graph.ts";
import { TECH_BY_ID, TECH_NODES, type TechSector } from "./catalog.ts";

/** Paints a crisp 32x32 Command Core / Keep icon for the root tech node. */
export function paintCommandCoreIcon(canvas: HTMLCanvasElement): void {
  const c = canvas.getContext("2d")!;
  const n = canvas.width;
  c.clearRect(0, 0, n, n);
  c.imageSmoothingEnabled = false;

  // Base armored platform
  c.fillStyle = "#161d29";
  c.fillRect(2, 2, n - 4, n - 4);
  c.strokeStyle = "#48586e";
  c.lineWidth = 1;
  c.strokeRect(2.5, 2.5, n - 5, n - 5);

  // Outer keep battlements / bastion blocks
  c.fillStyle = "#3d4b60";
  c.fillRect(4, 4, 6, 6);
  c.fillRect(n - 10, 4, 6, 6);
  c.fillRect(4, n - 10, 6, 6);
  c.fillRect(n - 10, n - 10, 6, 6);

  // Central Command Core spire
  c.fillStyle = "#5a6f8c";
  c.fillRect(9, 9, 14, 14);

  // Core energy emitter (glowing cyan / amber)
  c.fillStyle = "#0c1420";
  c.fillRect(12, 12, 8, 8);
  c.fillStyle = "#48e5ff";
  c.fillRect(13, 13, 6, 6);
  c.fillStyle = "#ffffff";
  c.fillRect(15, 15, 2, 2);

  // Cross reinforcement lines
  c.fillStyle = "#ffbe3b";
  c.fillRect(10, 15, 2, 2);
  c.fillRect(20, 15, 2, 2);
  c.fillRect(15, 10, 2, 2);
  c.fillRect(15, 20, 2, 2);
}
import {
  allocatedCurrencies,
  availableCurrencies,
  buyTechNode,
  prerequisitesMet,
  refundTechNode,
  respecAllTech,
  secondaryTechEdges,
  type VoidTechWallet,
} from "./wallet.ts";

const SECTOR_LABELS: Record<TechSector, string> = {
  foundation: "Foundation & Economy",
  reclamation: "Reclamation & Construction",
  infantry: "Infantry & Automation",
  containment: "Containment Engineering",
  strikes: "Strike Command",
  breakthroughs: "Research Breakthroughs",
};

export class VoidTechTreeView {
  private readonly graph: UpgradeGraph;
  private readonly circle = new MagicCircle();
  private picked = "commandCore";
  private filterSector: TechSector | "" = "";
  private searchQuery = "";
  private hasFittedVisible = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly getWallet: () => VoidTechWallet,
    private readonly isInBattle: () => boolean,
    private readonly reduceMotion: () => boolean,
    private readonly onChanged: () => void,
  ) {
    this.host.classList.add("void-tech-view");
    this.host.innerHTML = `
      <header class="void-tech-header">
        <div class="void-tech-title">
          <strong>Resistance Global Technology Network</strong>
          <small>All unlocked towers, strikes, AI logic, and passives apply globally across every run. Free between-run refunds.</small>
        </div>
        <div class="void-tech-controls">
          <span class="void-tech-pools" data-tech-pools></span>
          <label>Sector
            <select data-tech-sector>
              <option value="">All 6 Sectors (${TECH_NODES.length} nodes)</option>
              ${(Object.keys(SECTOR_LABELS) as TechSector[])
                .map((s) => `<option value="${s}">${SECTOR_LABELS[s]}</option>`)
                .join("")}
            </select>
          </label>
          <input type="search" data-tech-search placeholder="Search tech..." aria-label="Search technology nodes" />
          <button type="button" class="secondary-btn" data-tech-fit>Fit View</button>
          <button type="button" data-tech-respec class="danger-btn">Refund All</button>
        </div>
      </header>
      <div class="void-tech-stage">
        <div class="void-tech-graph"></div>
        <aside class="void-tech-card" data-tech-card></aside>
      </div>
    `;

    const stage = this.host.querySelector<HTMLElement>(".void-tech-stage")!;
    this.circle.attach(stage);

    const graphEl = this.host.querySelector<HTMLElement>(".void-tech-graph")!;
    this.graph = new UpgradeGraph(graphEl, {
      reduceMotion: this.reduceMotion,
      spatialCulling: true,
      onPick: (id) => {
        this.picked = id;
        this.render();
      },
      paint: (el) => {
        el.querySelectorAll<HTMLCanvasElement>("[data-icon]").forEach((c) =>
          paintCommandCoreIcon(c),
        );
        el.querySelectorAll<HTMLCanvasElement>("[data-path-icon]").forEach((c) => {
          const [icon, hue] = c.dataset.pathIcon!.split(":");
          paintPathIcon(c, icon as PathIcon, hue as PathHue);
        });
      },
    });
    this.graph.setSecondaryEdges(secondaryTechEdges());

    this.host.querySelector<HTMLSelectElement>("[data-tech-sector]")!.onchange = (e) => {
      this.filterSector = (e.target as HTMLSelectElement).value as TechSector | "";
      if (this.filterSector) {
        const first = TECH_NODES.find((n) => n.sector === this.filterSector);
        if (first) this.picked = first.id;
      }
      this.render();
      this.graph.refit(true);
    };

    this.host.querySelector<HTMLInputElement>("[data-tech-search]")!.oninput = (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
      if (this.searchQuery) {
        const match = TECH_NODES.find(
          (n) =>
            n.name.toLowerCase().includes(this.searchQuery) ||
            n.description.toLowerCase().includes(this.searchQuery),
        );
        if (match) this.picked = match.id;
      }
      this.render();
    };

    this.host.querySelector<HTMLButtonElement>("[data-tech-fit]")!.onclick = () => {
      this.graph.refit(true);
    };

    this.host.querySelector<HTMLButtonElement>("[data-tech-respec]")!.onclick = () => {
      if (this.isInBattle()) return;
      respecAllTech(this.getWallet(), false);
      this.circle.energize();
      this.onChanged();
      this.render();
    };

    this.render();
  }

  frame(now: number): void {
    this.circle.frame(now, this.reduceMotion());
  }

  render(): void {
    const wallet = this.getWallet();
    const inBattle = this.isInBattle();
    const avail = availableCurrencies(wallet);
    const alloc = allocatedCurrencies(wallet.ranks);

    const poolsEl = this.host.querySelector<HTMLElement>("[data-tech-pools]")!;
    poolsEl.innerHTML = `<span class="badge-essence">${avail.essence} Void Essence</span> · <span class="badge-sparks">${avail.sparks} Sparks of Defiance</span>`;

    const respecBtn = this.host.querySelector<HTMLButtonElement>("[data-tech-respec]")!;
    respecBtn.disabled = inBattle || (alloc.essence === 0 && alloc.sparks === 0);
    respecBtn.title = inBattle ? "Cannot refund upgrades during an active battle" : "Refund 100% of allocated Void Essence and Sparks";

    const nodes: GraphNode[] = TECH_NODES.map((n) => {
      const rank = wallet.ranks[n.id] ?? (n.id === "commandCore" ? 1 : 0);
      const maxRank = n.costs.length;
      const unlocked = prerequisitesMet(n, wallet.ranks);
      const state: "owned" | "next" | "locked" =
        rank > 0 ? "owned" : unlocked ? "next" : "locked";
      const dimmedBySector = this.filterSector && n.sector !== this.filterSector && n.id !== "commandCore";
      const dimmedBySearch =
        this.searchQuery &&
        !n.name.toLowerCase().includes(this.searchQuery) &&
        !n.description.toLowerCase().includes(this.searchQuery) &&
        n.id !== "commandCore";
      const dimmed = dimmedBySector || dimmedBySearch;
      const nextCost = rank < maxRank ? n.costs[rank] : n.costs[maxRank - 1];
      const currSymbol = n.currency === "sparks" ? " SPK" : " ESS";
      const tag =
        n.id === "commandCore"
          ? "CORE"
          : rank >= maxRank
            ? `MAX (${rank}/${maxRank})`
            : `${rank}/${maxRank} - ${nextCost}${currSymbol}`;
      const face =
        n.icon === "keep"
          ? `<canvas width="32" height="32" data-icon="keep"></canvas>`
          : `<canvas data-path-icon="${n.icon}:${n.hue}"></canvas>`;

      return {
        id: n.id,
        parent: n.parent,
        side: n.side,
        state: dimmed ? "locked" : state,
        face,
        hue: `hue-${n.hue}`,
        tag,
      };
    });

    this.graph.set(
      nodes,
      this.picked,
      TECH_NODES.map((n) => ({ id: n.id, parent: n.parent })),
    );
    if (!this.hasFittedVisible && this.host.clientWidth > 0) {
      this.hasFittedVisible = true;
      this.graph.refit(true);
    }

    this.circle.set({
      topic: "voidTech",
      upgrades: TECH_NODES.map((n) => ({ id: n.id, rank: wallet.ranks[n.id] ?? 0 })),
    });

    this.renderCard(wallet, inBattle, avail);
  }

  private renderCard(
    wallet: VoidTechWallet,
    inBattle: boolean,
    avail: { essence: number; sparks: number },
  ): void {
    const card = this.host.querySelector<HTMLElement>("[data-tech-card]")!;
    const node = TECH_BY_ID.get(this.picked) ?? TECH_NODES[0];
    const rank = wallet.ranks[node.id] ?? (node.id === "commandCore" ? 1 : 0);
    const maxRank = node.costs.length;
    const met = prerequisitesMet(node, wallet.ranks);
    const nextCost = rank < maxRank ? node.costs[rank] : 0;
    const canAfford =
      node.currency === "sparks" ? avail.sparks >= nextCost : avail.essence >= nextCost;
    const currLabel = node.currency === "sparks" ? "Sparks of Defiance" : "Void Essence";

    const reqNames = [
      ...(node.parent ? [TECH_BY_ID.get(node.parent)?.name ?? node.parent] : []),
      ...(node.requires ?? []).map((r) => TECH_BY_ID.get(r)?.name ?? r),
    ];

    card.innerHTML = `
      <div class="void-card-sector">${SECTOR_LABELS[node.sector]}</div>
      <h3>${node.name}</h3>
      <p class="void-card-desc">${node.description}</p>
      <div class="void-card-meta">
        <span>Rank: <b>${rank} / ${maxRank}</b></span>
        <span>Currency: <b>${currLabel}</b></span>
      </div>
      ${
        reqNames.length
          ? `<div class="void-card-reqs">Requires: ${reqNames.join(" + ")}</div>`
          : ""
      }
      ${
        inBattle
          ? `<p class="void-card-warn">Tech allocation is locked while an encounter is active.</p>`
          : ""
      }
      <div class="void-card-actions">
        ${
          node.id !== "commandCore" && rank < maxRank
            ? `<button type="button" class="primary-btn" data-card-buy ${
                inBattle || !met || !canAfford ? "disabled" : ""
              }>Research Rank ${rank + 1} (${nextCost} ${
                node.currency === "sparks" ? "Sparks" : "Essence"
              })</button>`
            : `<button type="button" class="secondary-btn" disabled>Max Rank Reached</button>`
        }
        ${
          node.id !== "commandCore" && rank > 0
            ? `<button type="button" data-card-refund class="secondary-btn" ${
                inBattle ? "disabled" : ""
              }>Refund Node (Cascades Dependents)</button>`
            : ""
        }
      </div>
    `;

    const buyBtn = card.querySelector<HTMLButtonElement>("[data-card-buy]");
    if (buyBtn) {
      buyBtn.onclick = () => {
        if (buyTechNode(wallet, node.id, this.isInBattle())) {
          this.graph.burst(node.id);
          this.circle.energize();
          this.onChanged();
          this.render();
        }
      };
    }

    const refundBtn = card.querySelector<HTMLButtonElement>("[data-card-refund]");
    if (refundBtn) {
      refundBtn.onclick = () => {
        if (refundTechNode(wallet, node.id, 0, this.isInBattle())) {
          this.circle.energize();
          this.onChanged();
          this.render();
        }
      };
    }
  }
}
