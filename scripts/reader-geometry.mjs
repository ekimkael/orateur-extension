import * as k from "./anatomy/kit/iso-kit.mjs"
import * as A from "./anatomy/kit/audit.mjs"

/**
 * Figure: the actual rounded reader card becomes a shallow physical panel.
 * Its native front stays blank for the original UI; only its enclosure and
 * glass lift together to expose an illustrative interior, never real hardware.
 * Parts before geometry: base (four feet, floor, four underside screws: 9),
 * enclosure (eight wall pieces, eight gasket pieces: 16), electronics (mounting
 * plate, four board spacers, board, four packages, eight contacts: 18), screen
 * support (four pads: 4), face (eight bezel pieces and glass: 9), controls
 * (five seats and five raised circular caps: 10). Total: 66.
 * Every solid records its drawn shape. Contacts meet flush, and the single
 * exploded channel moves the entire face 32 units without altering its design.
 */
export function buildReaderGeometry({ audit = false } = {}) {
  const width = 900
  const height = 550
  const facePlan = { x: -168, y: -60.890625, w: 336, d: 121.78125, r: 20 }
  const faceZ = 13.8
  const buttonZ = 18
  const travel = [0, 0, 32]
  const bounds = k.boxCorners(facePlan, -5, buttonZ + travel[2])
  const P = k.fitProjection(bounds, width, height, { pad: 95, azimuth: 60, elevation: 38 })
  const R = A.recorder(P, { order: ["exploded"] })
  const plan = (x, y, w, d, r = 1) => ({ x, y, w, d, r })

  function put(name, paths, shape, at, { moving = false, tone = "mid", inner = "", glass = false, className } = {}) {
    const svg = k.solidSvg(paths, { tone, inner, className: glass ? "reader-glass" : className })
    R.put({ name, at, piece: moving ? "exploded" : "", move: moving ? travel : [0, 0, 0], svg, shapes: [R.solid(shape)] })
  }

  function slab(name, p, z, h, options = {}) {
    put(name, k.slabOf(p, z, h, P, 16, 0.45), A.slab(p, z, h, { name }, 16),
      [p.x + p.w / 2, p.y + p.d / 2, z + h / 2], options)
  }

  function cylinder(name, x, y, r, z, h, options = {}) {
    put(name, k.cylinder(x, y, r, z, h, P, 48, options.bevel ?? 0.2), A.cylinder(x, y, r, z, h, { name, ground: options.ground }),
      [x, y, z + h / 2], options)
  }

  // Eight real wall sections form a hollow rounded ring, never a solid slab
  // overlapping the electronics. Quarter annuli share their exact end faces.
  function rim(name, p, thickness, z, h, options = {}) {
    const { x, y, w, d, r } = p
    for (const [side, q] of [
      ["back", plan(x + r, y, w - 2 * r, thickness, 0)],
      ["front", plan(x + r, y + d - thickness, w - 2 * r, thickness, 0)],
      ["left", plan(x, y + r, thickness, d - 2 * r, 0)],
      ["right", plan(x + w - thickness, y + r, thickness, d - 2 * r, 0)],
    ]) slab(`${name}.${side}`, q, z, h, options)
    for (const [corner, cx, cy, start] of [
      ["back-left", x + r, y + r, 180], ["back-right", x + w - r, y + r, 270],
      ["front-right", x + w - r, y + d - r, 0], ["front-left", x + r, y + d - r, 90],
    ]) {
      const arc = (radius) => Array.from({ length: 17 }, (_, i) => {
        const angle = (start + i * 90 / 16) * Math.PI / 180
        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
      })
      const ring = [...arc(r), ...arc(r - thickness).reverse()]
      const id = `${name}.${corner}`
      put(id, k.extrude(ring, z, h, P, { convex: false }), A.extruded(ring, z, h, { name: id }), [cx, cy, z + h / 2], options)
    }
  }

  for (const x of [-138, 138]) for (const y of [-31, 31]) {
    cylinder(`foot.${x}.${y}`, x, y, 6, -5, 5, { tone: "lo", ground: true })
  }
  slab("floor", facePlan, 0, 2, { tone: "lo" })
  for (const x of [-155, 155]) for (const y of [-45, 45]) {
    cylinder(`underside-fastener.${x}.${y}`, x, y, 1.8, -0.7, 0.7, { tone: "lo" })
  }
  rim("lower-shell", facePlan, 3, 2, 8, { tone: "mid" })
  rim("gasket", facePlan, 3, 10, 1, { tone: "lo" })
  slab("mounting-plate", k.insetPlan(facePlan, 7), 2, 0.8, { tone: "lo" })
  for (const x of [-115, 115]) for (const y of [-23, 23]) {
    cylinder(`board-spacer.${x}.${y}`, x, y, 3, 2.8, 1.7, { tone: "mid" })
  }
  slab("circuit-board", plan(-126, -34, 252, 68, 5), 4.5, 1, { tone: "mid" })
  for (const [i, q] of [
    plan(-85, -18, 40, 30, 2), plan(-25, -15, 30, 22, 2),
    plan(25, -15, 40, 22, 2), plan(80, -18, 25, 30, 2),
  ].entries()) {
    const mark = k.planOutline(k.insetPlan(q, 2), 6.9, P)
    slab(`package.${i}`, q, 5.5, 1.4, { tone: "hi", inner: k.lineSvg(mark, { tone: "faint" }) })
  }
  for (let i = 0; i < 8; i++) {
    slab(`contact.${i}`, plan(-112 + 30 * i, 22, 8, 3, 0.5), 5.5, 0.25, { tone: "hi" })
  }
  for (const x of [-148, 148]) for (const y of [-41, 41]) {
    slab(`screen-pad.${x}.${y}`, plan(x - 3, y - 3, 6, 6, 1.2), 2.8, 10.2, { tone: "mid" })
  }
  rim("face-enclosure", facePlan, 3, 11, 2, { moving: true, tone: "hi" })
  slab("front-glass", facePlan, 13, 0.8, { moving: true, tone: "hi", glass: true })
  for (const [i, cx] of [31, 73, 115, 265, 305].entries()) {
    const x = facePlan.x + cx
    const y = facePlan.y + 88.78125
    const r = i === 1 ? 20 : 18
    cylinder(`button-seat.${i}`, x, y, r + 0.6, faceZ, 0.6, { moving: true, tone: "lo" })
    cylinder(`button-cap.${i}`, x, y, r, 14.4, 3.6, {
      moving: true, tone: "hi", bevel: 0.6,
      className: `reader-button-cap${i === 1 ? " reader-primary-cap" : ""}`,
    })
  }

  const states = [0, 0.25, 0.5, 0.75, 1]
  A.settle(R, P, { states })
  if (audit) {
    const result = A.audit(R, P, { frames: states, apart: true })
    console.log(A.report(result))
    const failures = A.failures(result)
    if (failures) throw new Error(`Reader geometry audit failed: ${failures} problems`)
    console.log(`audit passed: ${R.solids.length} solids, ${states.length} states`)
  }
  const vector = k.axisVector(P, travel)
  const svg = R.items.sort((a, b) => a.key - b.key).map((item) =>
    `<g data-item="${item.name}"${item.piece ? ` data-motion="exploded" data-move="${vector.join(" ")}"` : ""}>${item.svg}</g>`
  ).join("")
  return { P, svg, width, height, faceZ, buttonZ, facePlan, parts: R.solids.length, travel }
}
