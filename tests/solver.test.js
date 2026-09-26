/*
 * 求解器测试：
 *  · 闭环矛盾样例（局部逐边累加非最优）的精确结论；
 *  · 字典序平局规则、方向性、权重、退化范围、自环等语义；
 *  · 错误定位（范围为空 / 参考点越界 / 端点不存在等）；
 *  · 与暴力枚举的随机对拍（仅测试使用枚举，求解器本身不枚举）；
 *  · 流值不变量：maxflow + 常量项 ≡ 割证书 + 常量项 ≡ 总代价（BigInt 精确）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const solver = require('../app/solver.js');

/* 闭环矛盾样例：与页面内置样例一致 */
const SAMPLE = {
  probes: [
    { id: 0, lo: -20, hi: 20 },
    { id: 1, lo: -20, hi: 20 },
    { id: 2, lo: -20, hi: 20 },
  ],
  reference: 0,
  edges: [
    { from: 0, to: 1, target: 5, weight: 1 },
    { from: 1, to: 2, target: 5, weight: 1 },
    { from: 0, to: 2, target: 6, weight: 10 },
  ],
};

function costOf(input, phasesById) {
  return input.edges.reduce(
    (s, e) => s + e.weight * Math.abs((phasesById[e.to] - phasesById[e.from]) - e.target),
    0,
  );
}

test('闭环矛盾样例：全局最优严格优于沿生成树逐边累加', () => {
  const r = solver.solve(SAMPLE);
  assert.ok(r.ok, JSON.stringify(r.errors));

  // 全局最优：相位 (0, 1, 6)，总代价 4
  assert.deepEqual(r.phases, [
    { id: 0, phase: 0 },
    { id: 1, phase: 1 },
    { id: 2, phase: 6 },
  ]);
  assert.equal(r.totalCost, 4n);

  // 沿生成树 P0→P1→P2 逐边累加得 (0, 5, 10)，代价 40
  const tree = { 0: 0, 1: 5, 2: 10 };
  const treeCost = costOf(SAMPLE, tree);
  assert.equal(treeCost, 40);
  assert.ok(r.totalCost < treeCost, '最小割结论必须优于局部累加');

  // 边明细：实际差 / 残差 / 贡献
  assert.deepEqual(
    r.edges.map((e) => [e.actual, e.residual, e.contribution]),
    [[1, -4, 4n], [5, 0, 0n], [6, 0, 0n]],
  );
});

test('参考探针固定为零，相位均在范围内', () => {
  const r = solver.solve(SAMPLE);
  const byId = Object.fromEntries(r.phases.map((p) => [p.id, p.phase]));
  assert.equal(byId[0], 0);
  for (const p of SAMPLE.probes) {
    assert.ok(byId[p.id] >= p.lo && byId[p.id] <= p.hi);
  }
});

test('字典序平局：无边时取各探针下限（参考为 0）', () => {
  const r = solver.solve({
    probes: [
      { id: 0, lo: -5, hi: 5 },
      { id: 1, lo: -3, hi: 7 },
      { id: 2, lo: 2, hi: 9 },
    ],
    reference: 0,
    edges: [],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.phases.map((p) => p.phase), [0, -3, 2]);
  assert.equal(r.totalCost, 0n);
});

test('字典序平局：等值约束下取分量最小解', () => {
  // x2 − x1 ≈ 0，x1,x2 ∈ [0,3]：最优解为任意 x1=x2，字典序最小为 (0,0,0)
  const r = solver.solve({
    probes: [
      { id: 0, lo: -5, hi: 5 },
      { id: 1, lo: 0, hi: 3 },
      { id: 2, lo: 0, hi: 3 },
    ],
    reference: 0,
    edges: [{ from: 1, to: 2, target: 0, weight: 2 }],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.phases.map((p) => p.phase), [0, 0, 0]);
});

test('权重决定折中位置（加权中位数）', () => {
  // |x1| + 3·|x1 − 10| 在 x1 = 10 处取最小
  const r = solver.solve({
    probes: [
      { id: 0, lo: -10, hi: 10 },
      { id: 1, lo: -10, hi: 10 },
      { id: 2, lo: 10, hi: 10 },
    ],
    reference: 0,
    edges: [
      { from: 0, to: 1, target: 0, weight: 1 },
      { from: 2, to: 1, target: 0, weight: 3 },
    ],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.phases.map((p) => p.phase), [0, 10, 10]);
  assert.equal(r.totalCost, 10n);
});

test('有向边方向语义：P1→P0 与 P0→P1 符号相反', () => {
  const mk = (from, to) => ({
    probes: [
      { id: 0, lo: -10, hi: 10 },
      { id: 1, lo: -10, hi: 10 },
    ],
    reference: 0,
    edges: [{ from, to, target: 5, weight: 1 }],
  });
  const r1 = solver.solve(mk(0, 1)); // x1 − x0 ≈ 5
  const r2 = solver.solve(mk(1, 0)); // x0 − x1 ≈ 5
  assert.equal(r1.phases[1].phase, 5);
  assert.equal(r2.phases[1].phase, -5);
});

test('自环边只贡献常数 w·|t|，不影响相位', () => {
  const r = solver.solve({
    probes: [
      { id: 0, lo: -5, hi: 5 },
      { id: 1, lo: 2, hi: 4 },
    ],
    reference: 0,
    edges: [{ from: 1, to: 1, target: 3, weight: 2 }],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.phases.map((p) => p.phase), [0, 2]);
  assert.equal(r.totalCost, 6n);
});

test('结果按探针标识升序排列，与输入顺序无关', () => {
  const r = solver.solve({
    probes: [
      { id: 2, lo: -9, hi: 9 },
      { id: 0, lo: -9, hi: 9 },
      { id: 1, lo: -9, hi: 9 },
    ],
    reference: 0,
    edges: [{ from: 0, to: 2, target: 4, weight: 1 }],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.phases.map((p) => p.id), [0, 1, 2]);
  assert.equal(r.phases[2].phase, 4);
});

test('错误定位：范围为空', () => {
  const r = solver.solve({
    probes: [
      { id: 0, lo: -5, hi: 5 },
      { id: 1, lo: 3, hi: 1 },
    ],
    reference: 0,
    edges: [],
  });
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.path.startsWith('probes[1]') && /范围为空/.test(e.message)),
    JSON.stringify(r.errors));
});

test('错误定位：参考探针越界（范围不含 0）', () => {
  const r = solver.solve({
    probes: [
      { id: 0, lo: 2, hi: 9 },
      { id: 1, lo: -5, hi: 5 },
    ],
    reference: 0,
    edges: [],
  });
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.path === 'reference' && /不包含 0/.test(e.message)),
    JSON.stringify(r.errors));
});

test('错误定位：边端点不存在', () => {
  const r = solver.solve({
    probes: [
      { id: 0, lo: -5, hi: 5 },
      { id: 1, lo: -5, hi: 5 },
    ],
    reference: 0,
    edges: [{ from: 0, to: 7, target: 1, weight: 1 }],
  });
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.path === 'edges[0].to' && /不存在/.test(e.message)),
    JSON.stringify(r.errors));
});

test('错误定位：权重非正整数、目标非整数、探针数量越界', () => {
  const base = {
    probes: [
      { id: 0, lo: -5, hi: 5 },
      { id: 1, lo: -5, hi: 5 },
    ],
    reference: 0,
  };
  let r = solver.solve({ ...base, edges: [{ from: 0, to: 1, target: 1, weight: 0 }] });
  assert.ok(!r.ok && r.errors.some((e) => e.path === 'edges[0].weight'));

  r = solver.solve({ ...base, edges: [{ from: 0, to: 1, target: 1.5, weight: 1 }] });
  assert.ok(!r.ok && r.errors.some((e) => e.path === 'edges[0].target'));

  r = solver.solve({ probes: [{ id: 0, lo: -5, hi: 5 }], reference: 0, edges: [] });
  assert.ok(!r.ok && r.errors.some((e) => e.path === 'probes'));

  r = solver.solve({
    probes: Array.from({ length: 41 }, (_, i) => ({ id: i, lo: -1, hi: 1 })),
    reference: 0,
    edges: [],
  });
  assert.ok(!r.ok && r.errors.some((e) => e.path === 'probes'));
});

test('错误定位：参考探针标识不存在', () => {
  const r = solver.solve({
    probes: [
      { id: 0, lo: -5, hi: 5 },
      { id: 1, lo: -5, hi: 5 },
    ],
    reference: 9,
    edges: [],
  });
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.path === 'reference' && /不存在/.test(e.message)));
});

/* ---------------- 与暴力枚举的随机对拍 ---------------- */

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 暴力枚举全部整数赋值：最小成本 + 字典序最小相位向量（按标识升序） */
function bruteForce(input) {
  const probes = [...input.probes].sort((a, b) => a.id - b.id);
  const idx = new Map(probes.map((p, i) => [p.id, i]));
  const ranges = probes.map((p) => {
    if (p.id === input.reference) return [0];
    const arr = [];
    for (let v = p.lo; v <= p.hi; v++) arr.push(v);
    return arr;
  });
  let best = Infinity;
  let bestVec = null;
  const x = new Array(probes.length);
  const rec = (i) => {
    if (i === probes.length) {
      let cost = 0;
      for (const e of input.edges) {
        cost += e.weight * Math.abs((x[idx.get(e.to)] - x[idx.get(e.from)]) - e.target);
      }
      if (cost < best || (cost === best && lexLess(x, bestVec))) {
        best = cost;
        bestVec = [...x];
      }
      return;
    }
    for (const v of ranges[i]) {
      x[i] = v;
      rec(i + 1);
    }
  };
  const lexLess = (a, b) => {
    if (!b) return true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  };
  rec(0);
  return { cost: best, vec: bestVec };
}

test('随机对拍：最小割结论与暴力枚举完全一致（成本 + 字典序最小向量）', () => {
  const rand = mulberry32(20260924);
  const ri = (n) => Math.floor(rand() * n);

  for (let trial = 0; trial < 300; trial++) {
    const n = 2 + ri(4); // 2–5 个探针
    const probes = [];
    for (let i = 0; i < n; i++) {
      const lo = ri(7) - 3; // −3..3
      const hi = lo + ri(4); // 宽度 0..3
      probes.push({ id: i, lo, hi });
    }
    const reference = ri(n);
    probes[reference] = { id: reference, lo: -ri(3), hi: ri(3) }; // 保证含 0

    const m = ri(9); // 0–8 条边
    const edges = [];
    for (let i = 0; i < m; i++) {
      edges.push({
        from: ri(n),
        to: ri(n),
        target: ri(13) - 6, // −6..6
        weight: 1 + ri(4), // 1..4
      });
    }

    const input = { probes, reference, edges };
    const r = solver.solve(input);
    assert.ok(r.ok, `trial ${trial}: ${JSON.stringify(r.errors)}`);

    const bf = bruteForce(input);
    const gotVec = r.phases.map((p) => p.phase);
    assert.equal(r.totalCost, BigInt(bf.cost), `trial ${trial} 成本不一致: ${JSON.stringify(input)}`);
    assert.deepEqual(gotVec, bf.vec, `trial ${trial} 字典序最小向量不一致: ${JSON.stringify(input)}`);

    // 流值/割证书不变量：maxflow + 常量项 ≡ 独立复算割容量 + 常量项 ≡ 总代价
    assert.equal(r.stats.flowValue + r.stats.constantTerm, r.totalCost,
      `trial ${trial} 流值不变量被破坏`);
    assert.equal(r.stats.cutValue + r.stats.constantTerm, r.totalCost,
      `trial ${trial} 割证书不变量被破坏`);

    // 逐条边贡献精确求和必须无损复算总代价（BigInt）
    const edgeSum = r.edges.reduce((s, e) => s + e.contribution, 0n);
    assert.equal(edgeSum, r.totalCost, `trial ${trial} 逐边贡献汇总与总代价不一致`);

    // 相位在范围内、参考为 0
    const byId = Object.fromEntries(r.phases.map((p) => [p.id, p.phase]));
    assert.equal(byId[reference], 0);
    for (const p of probes) {
      assert.ok(byId[p.id] >= p.lo && byId[p.id] <= p.hi, `trial ${trial} 相位越界`);
    }
  }
});

test('大目标差值不触发逐层展开（常量区间解析累加）', () => {
  const r = solver.solve({
    probes: [
      { id: 0, lo: -5, hi: 5 },
      { id: 1, lo: -5, hi: 5 },
    ],
    reference: 0,
    edges: [{ from: 0, to: 1, target: 1000000, weight: 3 }],
  });
  assert.ok(r.ok);
  // x1 − x0 最多为 5，残差恒为 5 − 1e6
  assert.deepEqual(r.phases.map((p) => p.phase), [0, 5]);
  assert.equal(r.totalCost, BigInt(3 * Math.abs(5 - 1000000)));
});

/* ---------------- 大权重精确性回归（1600 条观测） ---------------- */

test('大权重场景：总代价/逐边贡献/最小割证书无损复算为同一精确整数', () => {
  // P0 固定为零参考点，P1 ∈ [0,100]；799 条目标 0、799 条目标 100（同权重），
  // 再加一条目标 100 权重 120000000002、一条目标 99 权重 1，共 1600 条观测。
  // 最优 P1=100；精确总代价 799·120000000001·100 + 1 = 9588000000079901
  // （该数在 IEEE-754 双精度下与 9588000000079900 不可区分，会丢掉个位 1）。
  const W = 120000000001;
  const edges = [];
  for (let i = 0; i < 799; i++) edges.push({ from: 0, to: 1, target: 0, weight: W });
  for (let i = 0; i < 799; i++) edges.push({ from: 0, to: 1, target: 100, weight: W });
  edges.push({ from: 0, to: 1, target: 100, weight: 120000000002 });
  edges.push({ from: 0, to: 1, target: 99, weight: 1 });

  const r = solver.solve({
    probes: [
      { id: 0, lo: 0, hi: 0 },
      { id: 1, lo: 0, hi: 100 },
    ],
    reference: 0,
    edges,
  });
  assert.ok(r.ok, JSON.stringify(r.errors));

  // 全部 1600 条观测保留
  assert.equal(r.edges.length, 1600);

  // 结论 P0=0、P1=100
  assert.deepEqual(r.phases, [{ id: 0, phase: 0 }, { id: 1, phase: 100 }]);

  const EXPECTED = 9588000000079901n;
  assert.equal(r.totalCost, EXPECTED);
  // 必须是 BigInt，而非恰好等于该值附近偶数的双精度数
  assert.equal(typeof r.totalCost, 'bigint');

  // 逐条贡献精确相加（独立 BigInt 累加）
  const edgeSum = r.edges.reduce((s, e) => s + e.contribution, 0n);
  assert.equal(edgeSum, EXPECTED, '逐边贡献精确求和不等于总代价');

  // 每条边贡献自身精确：799 条目标 0 的边各为 W·100，其余满足的边为 0，目标 99 的边为 1
  assert.equal(r.edges[0].contribution, BigInt(W) * 100n);
  assert.equal(r.edges[798].contribution, BigInt(W) * 100n);
  assert.equal(r.edges[799].contribution, 0n);
  assert.equal(r.edges[1597].contribution, 0n);
  assert.equal(r.edges[1598].contribution, 0n); // 权重 120000000002、目标 100 被精确满足
  assert.equal(r.edges[1599].contribution, 1n);

  // 最小割证书：流值与独立复算割容量，加常量项后均等于总代价
  assert.equal(r.stats.flowValue + r.stats.constantTerm, EXPECTED,
    '最大流值 + 常量项不等于总代价');
  assert.equal(r.stats.cutValue + r.stats.constantTerm, EXPECTED,
    '最小割容量 + 常量项不等于总代价');
  assert.equal(r.stats.cutValue, r.stats.flowValue, '割容量与最大流值不一致');

  // 十进制展示无损（页面直接 String(totalCost)）
  assert.equal(String(r.totalCost), '9588000000079901');
});
