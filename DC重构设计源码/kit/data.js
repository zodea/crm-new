// 扫描件助手 UI Kit — 演示数据（贴近工地/财务场景，非真实企业）
// 暴露到 window 供各屏共享。
(function () {
  const invoices = [
    { id: "i1", name: "scan_0615_001.pdf", size: "1.2 MB", pages: 1, type: "增值税专用发票",
      number: "09442026000058760", date: "2026-06-15", buyer: "广州市瑞航建筑工程有限公司",
      seller: "广州市大板东建材有限公司", total: "128640.00", tax: "14798.23", rate: "13%",
      project: "合和新城·3 号楼", remark: "钢筋一批", status: "done", account: "pending", review: false },
    { id: "i2", name: "scan_0615_002.pdf", size: "0.9 MB", pages: 1, type: "增值税普通发票",
      number: "09442026000058761", date: "2026-06-14", buyer: "广州市瑞航建筑工程有限公司",
      seller: "花城珠江电线电缆有限公司", total: "45200.00", tax: "5199.12", rate: "13%",
      project: "合和新城·3 号楼", remark: "", status: "done", account: "pending", review: true },
    { id: "i3", name: "扫描件_汇丰水泥.pdf", size: "2.1 MB", pages: 2, type: "增值税专用发票",
      number: "09442026000058744", date: "2026-06-12", buyer: "广州市瑞航建筑工程有限公司",
      seller: "汇丰水泥制品有限公司", total: "86000.00", tax: "9893.81", rate: "13%",
      project: "锦绣华庭·南区", remark: "C30 商砼", status: "done", account: "posted", review: false,
      accountedAt: "2026-06-16 09:42" },
    { id: "i4", name: "IMG_2026_0610.jpg", size: "3.4 MB", pages: 1, type: "增值税普通发票",
      number: "09442026000058702", date: "2026-06-10", buyer: "广州市瑞航建筑工程有限公司",
      seller: "穗建五金机电经营部", total: "12380.00", tax: "1423.89", rate: "13%",
      project: "锦绣华庭·南区", remark: "电动工具", status: "done", account: "posted", review: false,
      accountedAt: "2026-06-11 17:08" },
    { id: "i5", name: "scan_0609_007.pdf", size: "0.7 MB", pages: 1, type: "—",
      number: "", date: "", buyer: "", seller: "", total: "", tax: "", rate: "",
      project: "", remark: "", status: "todo", account: "none", review: false },
    { id: "i6", name: "scan_0609_008.pdf", size: "0.8 MB", pages: 1, type: "—",
      number: "", date: "", buyer: "", seller: "", total: "", tax: "", rate: "",
      project: "", remark: "", status: "todo", account: "none", review: false },
    { id: "i7", name: "重复_汇丰水泥.pdf", size: "2.0 MB", pages: 2, type: "增值税专用发票",
      number: "09442026000058744", date: "2026-06-12", buyer: "广州市瑞航建筑工程有限公司",
      seller: "汇丰水泥制品有限公司", total: "86000.00", tax: "9893.81", rate: "13%",
      project: "锦绣华庭·南区", remark: "与 i3 重复", status: "dup", account: "none", review: false },
    { id: "i8", name: "扫描件_鸿运防水.pdf", size: "1.1 MB", pages: 1, type: "增值税专用发票",
      number: "09442026000058690", date: "2026-06-08", buyer: "广州市瑞航建筑工程有限公司",
      seller: "鸿运建筑防水工程有限公司", total: "33500.00", tax: "3853.98", rate: "13%",
      project: "合和新城·3 号楼", remark: "屋面防水", status: "done", account: "pending", review: true },
  ];

  const suppliers = [
    { id: "s1", name: "广州市大板东建材有限公司", aliases: ["大板东"], taxNo: "91440101MA5CBX1234",
      bank: "中国银行广州天河支行", account: "6217 8500 1234 5678", contact: "陈志强", phone: "13802201234", note: "钢材" },
    { id: "s2", name: "花城珠江电线电缆有限公司", aliases: ["花城电缆", "珠江电缆"], taxNo: "91440101MA5DEF5678",
      bank: "工商银行广州越秀支行", account: "6222 0202 8888 4321", contact: "李美玲", phone: "13902205678", note: "电线电缆" },
    { id: "s3", name: "汇丰水泥制品有限公司", aliases: ["汇丰水泥"], taxNo: "91440103MA5GHI9012",
      bank: "建设银行广州番禺支行", account: "6217 0001 2233 4455", contact: "黄国华", phone: "13602209012", note: "商砼" },
    { id: "s4", name: "穗建五金机电经营部", aliases: ["穗建五金"], taxNo: "91440104MA5JKL3456",
      bank: "农业银行广州海珠支行", account: "6228 4800 5566 7788", contact: "周伟", phone: "13802203456", note: "五金机电" },
    { id: "s5", name: "鸿运建筑防水工程有限公司", aliases: ["鸿运防水"], taxNo: "91440106MA5MNO7890",
      bank: "招商银行广州分行", account: "6225 8801 9988 7766", contact: "刘建军", phone: "13902207890", note: "防水" },
  ];

  const projects = [
    { id: "p1", name: "合和新城", status: "在建", address: "广州市白云区机场路 188 号", startDate: "2025-09-01", developer: "合和地产集团", manager: "张工" },
    { id: "p2", name: "锦绣华庭", status: "在建", address: "广州市番禺区市广路 66 号", startDate: "2026-01-15", developer: "锦绣置业有限公司", manager: "王工" },
    { id: "p3", name: "翠湖花园", status: "收尾", address: "广州市天河区天源路 9 号", startDate: "2024-11-20", developer: "翠湖投资", manager: "李工" },
    { id: "p4", name: "江湾一号", status: "停工", address: "广州市海珠区滨江东路 3 号", startDate: "2025-03-10", developer: "江湾置业", manager: "陈工" },
    { id: "p5", name: "车陂商业大楼", status: "在建", address: "广州市天河区车陂路 12 号", startDate: "2025-11-08", developer: "天河城建投资", manager: "周维" },
    { id: "p6", name: "科学城人才公寓", status: "在建", address: "广州市黄埔区科学大道 88 号", startDate: "2026-03-02", developer: "广州开发区建设集团", manager: "郑海峰" },
    { id: "p7", name: "亚运城C1标段", status: "完工", address: "广州市番禺区亚运大道 1 号", startDate: "2024-06-18", developer: "广州亚运城开发", manager: "何先进" },
    { id: "p8", name: "利丰北1-4号楼", status: "在建", address: "佛山市南海区利丰北路", startDate: "2026-02-25", developer: "利丰置业", manager: "刘乐喜" },
    { id: "p9", name: "领秀海5-6号楼", status: "收尾", address: "广州市番禺区领秀海花园", startDate: "2024-09-12", developer: "保利番禺地产", manager: "张工" },
    { id: "p10", name: "未来印象小区", status: "完工", address: "广州市增城区荔城街道", startDate: "2023-10-06", developer: "未来印象置业", manager: "王工" },
    { id: "p11", name: "白云机场配套宿舍", status: "在建", address: "广州市花都区机场北路", startDate: "2026-05-11", developer: "白云机场建设", manager: "陈工" },
    { id: "p12", name: "零星维修框架项目", status: "在建", address: "广州市内多点", startDate: "2026-01-01", developer: "广州市政集团", manager: "李工" },
  ];

  const workers = [
    { id: "w1", name: "虞建华", team: "泥水A班", project: "合和新城", onSite: true, phone: "13511220001", idCard: "330682198503117890", entryDate: "2024-08-15" },
    { id: "w2", name: "王芳（虞嫂）", team: "泥水A班", project: "合和新城", onSite: true, phone: "13511220002", idCard: "330682198706128901", entryDate: "2024-08-15" },
    { id: "w3", name: "张建国", team: "泥水A班", project: "合和新城", onSite: true, phone: "13511220003", idCard: "362426198712146789", entryDate: "2024-09-01" },
    { id: "w4", name: "匡志强", team: "泥水A班", project: "合和新城", onSite: true, phone: "13511220004", idCard: "430481198905264567", entryDate: "2024-09-10" },
    { id: "w5", name: "赵铁柱", team: "钢筋班", project: "合和新城", onSite: true, phone: "13511220005", idCard: "440181199003051234", entryDate: "2025-03-20" },
    { id: "w6", name: "孙大勇", team: "木工一班", project: "合和新城", onSite: true, phone: "13511220006", idCard: "511325198807122345", entryDate: "2025-01-12" },
    { id: "w7", name: "周伟峰", team: "水电班", project: "锦绣华庭", onSite: true, phone: "13511220007", idCard: "342221199211053456", entryDate: "2026-01-20" },
    { id: "w8", name: "郑明", team: "防水班", project: "翠湖花园", onSite: false, phone: "13511220008", idCard: "452123199001025678", entryDate: "2024-11-05", exitDate: "2026-02-28" },
  ];

  // 单价对比：行=材料，列=供应商
  const priceSuppliers = ["大板东", "汇丰水泥", "穗建五金"];
  const priceRows = [
    { key: "m1", name: "HRB400 螺纹钢 Φ12", unit: "吨", names: 3, by: { "大板东": { recent: 3980, min: 3920, max: 4050 } }, lowest: "大板东" },
    { key: "m2", name: "C30 商品混凝土", unit: "m³", names: 2, by: { "汇丰水泥": { recent: 462, min: 455, max: 470 } }, lowest: "汇丰水泥" },
    { key: "m3", name: "镀锌钢管 DN50", unit: "根", names: 4, by: { "大板东": { recent: 86, min: 86, max: 86 }, "穗建五金": { recent: 82, min: 80, max: 85 } }, lowest: "穗建五金" },
    { key: "m4", name: "膨胀螺栓 M10", unit: "盒", names: 1, by: { "穗建五金": { recent: 24, min: 22, max: 26 } }, lowest: "穗建五金" },
    { key: "m5", name: "防水卷材 SBS", unit: "卷", names: 2, by: { "大板东": { recent: 320, min: 315, max: 330 }, "汇丰水泥": { recent: 335, min: 330, max: 340 } }, lowest: "大板东" },
  ];

  // 送货单文件卡片
  const deliveryFiles = [
    { id: "d1", name: "大板东-20260614.pdf", partition: "合和新城", company: "广州市大板东建材有限公司", ocr: "done", date: "2026-06-14", no: "0005876", material: "螺纹钢 Φ12 / 8.5 吨", conflict: false },
    { id: "d2", name: "汇丰水泥-0612.jpg", partition: "锦绣华庭", company: "汇丰水泥制品有限公司", ocr: "done", date: "2026-06-12", no: "0012043", material: "C30 商砼 / 186 m³", conflict: false },
    { id: "d3", name: "未命名扫描_07.pdf", partition: "合和新城", company: "花城珠江电线电缆有限公司", ocr: "review", date: "2026-06-11", no: "—", material: "电缆 YJV / 待复核", conflict: true },
    { id: "d4", name: "穗建五金-0610.pdf", partition: "锦绣华庭", company: "穗建五金机电经营部", ocr: "todo", date: "—", no: "—", material: "—", conflict: false },
  ];

  // ——— 班组（全局实体，跨项目复用） ———
  const crews = [
    { id: "c1", name: "泥水A班", trade: "泥水工", contact: "虞师傅", phone: "13700110001", workerCount: 8, projectCount: 2, note: "墙地砖主力班组" },
    { id: "c2", name: "泥水B班", trade: "泥水工", contact: "张师傅", phone: "13700110002", workerCount: 6, projectCount: 1, note: "" },
    { id: "c3", name: "木工一班", trade: "木工", contact: "孙师傅", phone: "13700110003", workerCount: 5, projectCount: 2, note: "模板·吊顶" },
    { id: "c4", name: "钢筋班", trade: "钢筋工", contact: "赵师傅", phone: "13700110004", workerCount: 10, projectCount: 1, note: "" },
    { id: "c5", name: "防水班", trade: "防水工", contact: "刘师傅", phone: "13700110005", workerCount: 4, projectCount: 3, note: "屋面·卫生间" },
    { id: "c6", name: "水电班", trade: "水暖工", contact: "周师傅", phone: "13700110006", workerCount: 7, projectCount: 2, note: "" },
  ];

  // 班组×项目 配置（详情页用）
  const crewConfig = {
    crew: "泥水A班", project: "合和新城", ratio: 0.95,
    rentEnabled: true, rentPrice: 3.0, mgmtEnabled: true, mgmtPrice: 1.5,
    items: [
      { name: "墙砖铺贴", unit: "㎡", price: 38, inRent: true, inMgmt: true },
      { name: "地砖铺贴", unit: "㎡", price: 32, inRent: true, inMgmt: true },
      { name: "脚线", unit: "m", price: 8, inRent: false, inMgmt: true },
      { name: "淋浴板", unit: "套", price: 120, inRent: false, inMgmt: false },
      { name: "防水", unit: "㎡", price: 25, inRent: false, inMgmt: false },
    ],
    workers: ["虞师傅", "虞嫂", "张师傅", "匡师傅", "李师傅", "何嫂", "文师傅", "老陈"],
    workerConfigs: [
      { worker: "虞师傅", mode: "piece", rent: null, mgmt: null, ratio: null, role: "班组长" },
      { worker: "虞嫂", mode: "piece", rent: null, mgmt: null, ratio: null, linked: "虞师傅" },
      { worker: "张师傅", mode: "piece", rent: null, mgmt: false, ratio: null },
      { worker: "匡师傅", mode: "piece", rent: false, mgmt: null, ratio: 0.9 },
      { worker: "李师傅", mode: "piece", rent: null, mgmt: null, ratio: null },
      { worker: "何嫂", mode: "piece", rent: null, mgmt: null, ratio: 0.9 },
      { worker: "文师傅", mode: "piece", rent: false, mgmt: false, ratio: null },
      { worker: "老陈", mode: "time", rent: false, mgmt: false, ratio: null, daily: 280 },
    ],
  };

  // ——— 工程量矩阵（楼层×户号×分项，按月着色） ———
  const mxMonths = [
    { key: "2024-09", label: "2024.9", bg: "#e7e9fd", ink: "#3730a3", dot: "#6366f1" },
    { key: "2024-11", label: "2024.11", bg: "#d6f5e3", ink: "#065f46", dot: "#10b981" },
    { key: "2025-01", label: "2025.1", bg: "#ffe1e6", ink: "#9f1239", dot: "#f43f5e" },
    { key: "2025-04", label: "2025.4", bg: "#fef0cd", ink: "#92400e", dot: "#f59e0b" },
  ];
  const mxFloors = ["39F", "38F", "37F", "36F", "35F", "34F", "33F"];
  const mxUnits = ["01户", "02户", "03户", "04户"];
  const mxItems = ["墙砖", "地砖"];
  // 楼层 → 完成月份（自下而上施工：底层早、顶层晚；39F 尚未施工）
  const floorMonth = { "33F": "2024-09", "34F": "2024-09", "35F": "2024-11", "36F": "2024-11", "37F": "2025-01", "38F": "2025-04", "39F": null };
  // 墙砖按户固定工人；地砖按户固定工人；01 户为夫妻关联（虞师傅/虞嫂）
  const wallWorker = { "01户": "虞师傅", "02户": "匡师傅", "03户": "李师傅", "04户": "李师傅" };
  const floorTileWorker = { "01户": "张师傅", "02户": "张师傅", "03户": "何嫂", "04户": "文师傅" };
  const mxCells = {};
  mxFloors.forEach((f, fi) => {
    const month = floorMonth[f];
    mxUnits.forEach((u, ui) => {
      // 制造部分未施工：39F 全空；38F 仅 01/02 户完成
      let done = month != null;
      if (f === "38F" && (u === "03户" || u === "04户")) done = false;
      if (!done) return;
      const wallQty = 28 + ((fi * 3 + ui * 5) % 14);
      const tileQty = 18 + ((fi * 2 + ui * 4) % 9);
      mxCells[f + "|" + u] = [
        { item: "墙砖", worker: wallWorker[u], partner: u === "01户" ? "虞嫂" : null, month, qty: wallQty },
        { item: "地砖", worker: floorTileWorker[u], partner: null, month, qty: tileQty },
      ];
    });
  });
  const matrix = { buildings: ["1栋", "2栋", "3栋"], months: mxMonths, floors: mxFloors, units: mxUnits, items: mxItems, cells: mxCells };

  // ——— 工资核算 ———
  const payroll = {
    crew: "泥水A班", project: "合和新城", month: "2025-04", ratioLabel: "95%",
    ratioSchedule: [
      { m: "2024.9", r: "75%" }, { m: "2024.11", r: "75%" }, { m: "2025.1", r: "85%" },
      { m: "2025.4", r: "95%", current: true }, { m: "结算", r: "100%" },
    ],
    rows: [
      { worker: "虞师傅", mode: "piece", engineering: 48260, rent: 3200, mgmt: 1800, ratio: 0.95, prevPaid: 38000, deduct: 1200, safety: true },
      { worker: "张师傅", mode: "piece", engineering: 36200, rent: 2400, mgmt: 1300, ratio: 0.95, prevPaid: 29000, deduct: 0, safety: true },
      { worker: "匡师傅", mode: "piece", engineering: 29800, rent: 0, mgmt: 1100, ratio: 0.95, prevPaid: 24000, deduct: 500, safety: false },
      { worker: "李师傅", mode: "piece", engineering: 41200, rent: 2800, mgmt: 1500, ratio: 0.95, prevPaid: 33000, deduct: 0, safety: true },
      { worker: "何嫂", mode: "piece", engineering: 22600, rent: 1600, mgmt: 800, ratio: 0.9, prevPaid: 17000, deduct: 0, safety: true },
      { worker: "老陈（杂工）", mode: "time", days: 24, daily: 280, deduct: 0, safety: true },
    ],
    detail: {
      worker: "虞师傅", partner: "虞嫂", building: "1栋",
      roundNote: "工程量按 0.01㎡ 取整 · 金额按元四舍五入取整",
      lines: [
        { name: "墙砖铺贴", unit: "㎡", price: 38, qty: 980.36,
          calc: [
            { room: "37F-01户 客厅", expr: "7.55×(3.05-0.08)-1.2×(2.4-0.08)", val: 19.62 },
            { room: "37F-01户 主卧", expr: "(3.6×2.65-0.9×2.1)×2", val: 15.30 },
            { room: "37F-01户 卫生间", expr: "(2.1+1.8)×2×2.4-0.8×2.0", val: 17.12 },
            { room: "36F-01户 客厅", expr: "7.55×(3.05-0.08)-1.2×(2.4-0.08)", val: 19.62 },
            { room: "…共 26 间", expr: "", val: null, summary: true },
          ],
          calcTotal: 980.36 },
        { name: "脚线", unit: "m", price: 8, qty: 420 },
        { name: "淋浴板", unit: "套", price: 120, qty: 18 },
        { name: "防水", unit: "㎡", price: 25, qty: 220 },
      ],
      rent: 3200, mgmt: 1800, ratio: 0.95, prevPaid: 38000,
      deductItems: [{ reason: "空鼓罚款 · 3 处", amt: 600 }, { reason: "未收尾扣款", amt: 600 }],
    },
  };

  const projectCrews = {
    "合和新城": [
      { crew: "泥水A班", trade: "泥水工", workers: 8, net: 47602, hasData: true },
      { crew: "木工一班", trade: "木工", workers: 5, net: 0, hasData: false },
      { crew: "钢筋班", trade: "钢筋工", workers: 10, net: 0, hasData: false },
    ],
    "锦绣华庭": [
      { crew: "泥水B班", trade: "泥水工", workers: 6, net: 0, hasData: false },
      { crew: "水电班", trade: "水暖工", workers: 7, net: 0, hasData: false },
    ],
    "翠湖花园": [{ crew: "防水班", trade: "防水工", workers: 4, net: 0, hasData: false }],
    "江湾一号": [],
  };

  const factorDefaults = [
    { id: "f1", name: "HRB400 螺纹钢 Φ12", unit: "吨", price: 3980 },
    { id: "f2", name: "C30 商品混凝土", unit: "m³", price: 462 },
    { id: "f3", name: "镀锌钢管 DN50", unit: "根", price: 86 },
    { id: "f4", name: "防水卷材 SBS", unit: "卷", price: 320 },
  ];

  window.KIT_DATA = { invoices, suppliers, projects, workers, priceSuppliers, priceRows, deliveryFiles, crews, crewConfig, matrix, payroll, projectCrews, factorDefaults };
})();
