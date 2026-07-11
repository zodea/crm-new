// AppData — 跨页共享业务数据 store（反馈轮 9 第二层：双页/多页联动地基）
// 与 ScheduleData(排程)/InvoiceShared(发票域) 同模式：隐藏预载注册 window.APP，subscribe/notify 订阅刷新。
// 集合：projects / suppliers / contracts（批A）—— 列表页/详情页/项目详情Tab 共用同一份数据，任一处编辑另一处实时可见。
// 约定：页面不再各自 useState(data.xxx.slice()) 持有副本；读 APP.rows()，改走 APP.update/add/softDel。
(function () {
  if (window.APP) { window.AppDataScreen = window.AppDataScreen || function () { return null; }; return; }

  const listeners = new Set();
  const notify = () => listeners.forEach((f) => { try { f(); } catch (e) {} });
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  // —— 项目扩展字段（红圈式列表列 + 详情基础信息；原 ProjectScreen 内 EXT 上移到此，两页共用）——
  const EXT = {
    p1: { income: 17200000, budget: 26800000, planEnd: "2026-12-30", execManager: "刘志强", builder: "黄伟明" },
    p2: { income: 6800000, budget: 14200000, planEnd: "2027-03-15", execManager: "梁国栋", builder: "宋子豪" },
    p3: { income: 30500000, budget: 29800000, planEnd: "2026-08-30", actualEnd: "", execManager: "陈志明", builder: "冯家俊" },
    p4: { income: 4200000, budget: 12600000, planEnd: "—", execManager: "赵德柱", builder: "—" },
    p5: { income: 8600000, budget: 15800000, planEnd: "2026-11-30", execManager: "周维", builder: "吴大龙" },
    p6: { income: 3100000, budget: 9800000, planEnd: "2027-01-20", execManager: "郑海峰", builder: "许志安" },
    p7: { income: 21800000, budget: 20600000, planEnd: "2025-12-31", actualEnd: "2025-12-18", execManager: "何先进", builder: "郭天佑" },
    p8: { income: 2400000, budget: 11200000, planEnd: "2027-04-30", execManager: "刘乐喜", builder: "邓建华" },
    p9: { income: 18600000, budget: 18200000, planEnd: "2026-06-30", actualEnd: "", execManager: "张建军", builder: "叶国强" },
    p10: { income: 9800000, budget: 9200000, planEnd: "2024-12-31", actualEnd: "2024-12-20", execManager: "王志文", builder: "钟伟雄" },
    p11: { income: 1200000, budget: 8600000, planEnd: "2027-06-30", execManager: "陈家豪", builder: "罗永康" },
    p12: { income: 860000, budget: 2400000, planEnd: "长期", execManager: "李建国", builder: "多班组" },
  };
  const statusToStage = { "在建": "施工中", "收尾": "完工及竣备", "停工": "停工", "完工": "保修" };
  const mergeProject = (p) => ({
    ...p, ...(EXT[p.id] || {}),
    stage: p.stage || statusToStage[p.status] || "施工中",
    contractName: p.contractName || (p.name + (p.id === "p12" ? "维修框架协议" : "施工总承包合同")),
  });

  // —— 分供方扩展（口径 = 原 SupplierScreen META，上移到 store 供列表/详情共用）——
  const SUP_EXT = {
    s1: { category: "材料供应商", cred: "qualified", parent: "" },
    s2: { category: "材料供应商", cred: "reviewing", parent: "" },
    s3: { category: "材料供应商", cred: "qualified", parent: "" },
    s4: { category: "设备供应商", cred: "incomplete", parent: "" },
    s5: { category: "劳务分包商", cred: "qualified", parent: "" },
    // 批A 新增乙方（合同主线蓝链落点）
    s6: { category: "劳务分包商", cred: "qualified", parent: "" },
    s7: { category: "材料供应商", cred: "qualified", parent: "" },
    s8: { category: "专业分包商", cred: "qualified", parent: "" },
    s9: { category: "专业分包商", cred: "reviewing", parent: "" },
    s10: { category: "专业分包商", cred: "qualified", parent: "" },
  };
  // 合同总额/累计支付/项目数一律从 contracts 派生（批A 同源化：分供方页数字不再与合同列表打架）
  const supAgg = (sid, contracts) => {
    const list = (contracts || []).filter((c) => c.supplierId === sid);
    if (!list.length) return { projectCount: 0, contractTotal: 0, paidTotal: 0 };
    return {
      projectCount: new Set(list.map((c) => c.projectId)).size,
      contractTotal: list.reduce((s, c) => s + (Number(c.amount) || 0), 0),
      paidTotal: list.reduce((s, c) => s + (Number(c.paid) || 0), 0),
    };
  };
  const mergeSupplier = (s, contracts) => ({ category: "其他", cred: "incomplete", parent: "", ...supAgg(s.id, contracts), ...(SUP_EXT[s.id] || {}), ...s });

  // 批B 资金域集合直通入仓（无 merge 扩展，CRUD 走通用 rows/add/update/softDel）
  const PLAIN_COLLS = ["contracts", "payApplies", "receipts", "invApplies", "currents", "payRecords", "reimburses"];
  const state = { projects: [], suppliers: [] };
  PLAIN_COLLS.forEach((k) => { state[k] = []; });
  const init = () => {
    const d = window.KIT_DATA;
    if (!d) return false;
    state.projects = (d.projects || []).map(mergeProject);
    PLAIN_COLLS.forEach((k) => { state[k] = (d[k] || []).slice(); });
    state.suppliers = (d.suppliers || []).map((s) => mergeSupplier(s, d.contracts));
    return true;
  };
  if (!init()) { const t = setInterval(() => { if (init()) { clearInterval(t); notify(); } }, 50); }

  const rows = (coll) => (state[coll] || []).filter((x) => !x.discarded);
  const all = (coll) => state[coll] || [];
  const get = (coll, id) => (state[coll] || []).find((x) => x.id === id);
  const update = (coll, id, patch) => { state[coll] = state[coll].map((x) => (x.id === id ? { ...x, ...patch } : x)); notify(); };
  const add = (coll, row) => { state[coll] = [coll === "projects" ? mergeProject(row) : coll === "suppliers" ? mergeSupplier(row, state.contracts) : row, ...state[coll]]; notify(); };
  const softDel = (coll, id) => update(coll, id, { discarded: true });
  const restore = (coll, id) => update(coll, id, { discarded: false });

  // React 订阅 hook：任何页面 const A = window.APP; A.use(); 后读 A.rows('projects')
  const use = () => {
    const [, force] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => subscribe(force), []);
  };

  window.APP = { subscribe, notify, rows, all, get, update, add, softDel, restore, use };
  window.AppDataScreen = function () { return null; };
})();
