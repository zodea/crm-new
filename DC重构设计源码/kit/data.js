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
    // 批A：合同主线新增乙方（分包/材采蓝链落点，稳定 id 够跳转即可）
    { id: "s6", name: "陈家泥水班组", aliases: ["陈家班"], taxNo: "92440101MA5PQR1122",
      bank: "农业银行广州白云支行", account: "6228 4801 2233 9900", contact: "陈家旺", phone: "13802209988", note: "泥水劳务" },
    { id: "s7", name: "广东宏宇陶瓷有限公司", aliases: ["宏宇陶瓷"], taxNo: "91440605MA5STU3344",
      bank: "工商银行佛山禅城支行", account: "6222 0203 1122 5566", contact: "罗建平", phone: "13902203344", note: "瓷砖" },
    { id: "s8", name: "佛山华铝装饰工程有限公司", aliases: ["华铝装饰"], taxNo: "91440604MA5VWX5566",
      bank: "建设银行佛山南海支行", account: "6217 0002 3344 7788", contact: "曾志华", phone: "13602205566", note: "铝扣板供应安装" },
    { id: "s9", name: "广州赛雄脚手架工程有限公司", aliases: ["赛雄脚手架"], taxNo: "91440111MA5YZA7788",
      bank: "中国银行广州黄埔支行", account: "6217 8501 5566 3344", contact: "麦志雄", phone: "13802207788", note: "脚手架搭设" },
    { id: "s10", name: "恒安机电安装工程有限公司", aliases: ["恒安机电"], taxNo: "91440113MA5BCD9900",
      bank: "招商银行广州番禺支行", account: "6225 8802 7788 1122", contact: "谭永恒", phone: "13902209900", note: "机电安装" },
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

  // ——— 合同轻实体仓（批A：稳定 id 够蓝链跳转，金额 mock）———
  // kind: 施工(收入侧,挂 projectId,乙方=我方/甲方=项目 developer) / 分包(subKind 劳务|专业) / 材采（后两者挂 projectId+supplierId）
  // 四级对账链：amount 含税合同金额 → changed 变更后合同金额 → settled 累计结算 → invoiced 累计收票(施工=累计开票) → paid 累计支付(施工=累计收款)
  // p1–p4 的施工合同金额与项目详情 Tab③ 驾驶舱口径(m.biz.main)同源对齐；doc=合同文书,boqs=清单拆表附件(仅施工)
  const contracts = [
    // —— 施工合同（每项目 1 份，甲方=developer）——
    { id: "sg01", no: "RJ-HHXC-SG-2025001", name: "合和新城施工总承包合同", kind: "施工", projectId: "p1", supplierId: null,
      amount: 32388422, changed: 32388422, settled: 26100000, invoiced: 25800000, paid: 25367027, signDate: "2025-09-01", status: "履约中",
      doc: { name: "施工合同正本.pdf", pages: 32 },
      boqs: [{ name: "合和七期户内合同版-清单.xlsx", parsed: true, rows: 1286 }, { name: "公区清单.xlsx", parsed: false }] },
    { id: "sg02", no: "RJ-JXHT-SG-2026002", name: "锦绣华庭施工总承包合同", kind: "施工", projectId: "p2", supplierId: null,
      amount: 18600000, changed: 18920000, settled: 9800000, invoiced: 9800000, paid: 9800000, signDate: "2026-01-15", status: "履约中",
      doc: { name: "施工合同正本.pdf", pages: 28 }, boqs: [{ name: "锦绣华庭-工程量清单.xlsx", parsed: false }] },
    { id: "sg03", no: "RJ-CHHY-SG-2024003", name: "翠湖花园施工总承包合同", kind: "施工", projectId: "p3", supplierId: null,
      amount: 9800000, changed: 9920000, settled: 9350000, invoiced: 9200000, paid: 9100000, signDate: "2024-11-20", status: "履约中",
      doc: { name: "施工合同正本.pdf", pages: 26 }, boqs: [{ name: "翠湖花园-工程量清单.xlsx", parsed: false }] },
    { id: "sg04", no: "RJ-JWYH-SG-2025004", name: "江湾一号施工总承包合同", kind: "施工", projectId: "p4", supplierId: null,
      amount: 12000000, changed: 12000000, settled: 2400000, invoiced: 2400000, paid: 2400000, signDate: "2025-03-10", status: "履约中",
      doc: { name: "施工合同正本.pdf", pages: 30 } },
    { id: "sg05", no: "RJ-CBSY-SG-2025005", name: "车陂商业大楼施工总承包合同", kind: "施工", projectId: "p5", supplierId: null,
      amount: 15800000, changed: 15800000, settled: 8600000, invoiced: 8600000, paid: 8600000, signDate: "2025-11-08", status: "履约中",
      doc: { name: "施工合同正本.pdf", pages: 30 } },
    { id: "sg06", no: "RJ-KXC-SG-2026006", name: "科学城人才公寓施工总承包合同", kind: "施工", projectId: "p6", supplierId: null,
      amount: 9800000, changed: 9800000, settled: 3100000, invoiced: 3100000, paid: 3100000, signDate: "2026-03-02", status: "履约中",
      doc: { name: "施工合同正本.pdf", pages: 24 } },
    { id: "sg07", no: "RJ-YYC-SG-2024007", name: "亚运城C1标段施工总承包合同", kind: "施工", projectId: "p7", supplierId: null,
      amount: 20600000, changed: 21800000, settled: 21800000, invoiced: 21800000, paid: 21800000, signDate: "2024-06-18", status: "已结清",
      doc: { name: "施工合同正本.pdf", pages: 36 } },
    { id: "sg08", no: "RJ-LFB-SG-2026008", name: "利丰北1-4号楼施工总承包合同", kind: "施工", projectId: "p8", supplierId: null,
      amount: 11200000, changed: 11200000, settled: 2400000, invoiced: 2400000, paid: 2400000, signDate: "2026-02-25", status: "履约中",
      doc: { name: "施工合同正本.pdf", pages: 28 } },
    { id: "sg09", no: "RJ-LXH-SG-2024009", name: "领秀海5-6号楼施工总承包合同", kind: "施工", projectId: "p9", supplierId: null,
      amount: 18200000, changed: 18600000, settled: 18600000, invoiced: 18300000, paid: 17900000, signDate: "2024-09-12", status: "已结算",
      doc: { name: "施工合同正本.pdf", pages: 32 } },
    { id: "sg10", no: "RJ-WLYX-SG-2023010", name: "未来印象小区施工总承包合同", kind: "施工", projectId: "p10", supplierId: null,
      amount: 9200000, changed: 9800000, settled: 9800000, invoiced: 9800000, paid: 9800000, signDate: "2023-10-06", status: "已结清",
      doc: { name: "施工合同正本.pdf", pages: 26 } },
    { id: "sg11", no: "RJ-BYJC-SG-2026011", name: "白云机场配套宿舍施工总承包合同", kind: "施工", projectId: "p11", supplierId: null,
      amount: 8600000, changed: 8600000, settled: 1200000, invoiced: 1200000, paid: 1200000, signDate: "2026-05-11", status: "履约中",
      doc: { name: "施工合同正本.pdf", pages: 22 } },
    { id: "sg12", no: "RJ-LXWX-SG-2026012", name: "零星维修框架协议", kind: "施工", projectId: "p12", supplierId: null,
      amount: 2400000, changed: 2400000, settled: 860000, invoiced: 860000, paid: 860000, signDate: "2026-01-01", status: "履约中",
      doc: { name: "维修框架协议.pdf", pages: 12 } },
    // —— 分包合同（劳务/专业）——
    { id: "fb01", no: "RJ-HHXC-FB-2025001", name: "泥水班组劳务分包合同", kind: "分包", subKind: "劳务", projectId: "p1", supplierId: "s6",
      amount: 2860000, changed: 3038000, settled: 1240000, invoiced: 1050000, paid: 980000, signDate: "2025-10-12", status: "履约中",
      doc: { name: "劳务分包合同.pdf", pages: 16 } },
    { id: "fb02", no: "RJ-HHXC-FB-2026002", name: "铝扣板供应及安装合同", kind: "分包", subKind: "专业", projectId: "p1", supplierId: "s8",
      amount: 920000, changed: 920000, settled: 0, invoiced: 0, paid: 0, signDate: "2026-05-18", status: "已签订",
      doc: { name: "专业分包合同.pdf", pages: 14 } },
    { id: "fb03", no: "RJ-HHXC-FB-2025003", name: "屋面防水专业分包合同", kind: "分包", subKind: "专业", projectId: "p1", supplierId: "s5",
      amount: 560000, changed: 560000, settled: 560000, invoiced: 560000, paid: 560000, signDate: "2025-11-02", status: "已结清",
      doc: { name: "专业分包合同.pdf", pages: 12 } },
    { id: "fb04", no: "RJ-JXHT-FB-2026004", name: "锦绣华庭泥水劳务分包合同", kind: "分包", subKind: "劳务", projectId: "p2", supplierId: "s6",
      amount: 1680000, changed: 1680000, settled: 420000, invoiced: 380000, paid: 360000, signDate: "2026-02-20", status: "履约中",
      doc: { name: "劳务分包合同.pdf", pages: 16 } },
    { id: "fb05", no: "RJ-JXHT-FB-2026005", name: "机电安装专业分包合同", kind: "分包", subKind: "专业", projectId: "p2", supplierId: "s10",
      amount: 2150000, changed: 2150000, settled: 640000, invoiced: 600000, paid: 600000, signDate: "2026-03-05", status: "履约中",
      doc: { name: "专业分包合同.pdf", pages: 18 } },
    { id: "fb06", no: "RJ-CBSY-FB-2025006", name: "脚手架搭设专业分包合同", kind: "分包", subKind: "专业", projectId: "p5", supplierId: "s9",
      amount: 760442, changed: 760442, settled: 266692, invoiced: 266692, paid: 266692, signDate: "2025-12-29", status: "履约中",
      doc: { name: "专业分包合同.pdf", pages: 10 } },
    { id: "fb07", no: "RJ-CHHY-FB-2025007", name: "防水维修劳务合同", kind: "分包", subKind: "劳务", projectId: "p3", supplierId: "s5",
      amount: 180000, changed: 180000, settled: 180000, invoiced: 180000, paid: 180000, signDate: "2025-06-15", status: "已结算",
      doc: { name: "劳务合同.pdf", pages: 8 } },
    { id: "fb08", no: "RJ-KXC-FB-2026008", name: "科学城泥水劳务分包合同", kind: "分包", subKind: "劳务", projectId: "p6", supplierId: "s6",
      amount: 1240000, changed: 1240000, settled: 0, invoiced: 0, paid: 0, signDate: "2026-06-10", status: "已签订",
      doc: { name: "劳务分包合同.pdf", pages: 16 } },
    { id: "fb09", no: "RJ-LXH-FB-2025009", name: "领秀海泥水劳务分包合同", kind: "分包", subKind: "劳务", projectId: "p9", supplierId: "s6",
      amount: 890000, changed: 890000, settled: 890000, invoiced: 890000, paid: 850000, signDate: "2025-01-08", status: "已结算",
      doc: { name: "劳务分包合同.pdf", pages: 14 } },
    // —— 材料采购合同 ——
    { id: "cg01", no: "RJ-HHXC-CG-2026001", name: "瓷砖采购合同", kind: "材采", projectId: "p1", supplierId: "s7",
      amount: 3580000, changed: 3580000, settled: 2150000, invoiced: 2150000, paid: 1980000, signDate: "2026-01-15", status: "履约中",
      doc: { name: "材料采购合同.pdf", pages: 10 } },
    { id: "cg02", no: "RJ-HHXC-CG-2025002", name: "钢筋采购合同", kind: "材采", projectId: "p1", supplierId: "s1",
      amount: 1525000, changed: 1525000, settled: 1264000, invoiced: 1264000, paid: 865000, signDate: "2025-09-20", status: "履约中",
      doc: { name: "材料采购合同.pdf", pages: 8 } },
    { id: "cg03", no: "RJ-HHXC-CG-2025003", name: "商砼采购合同", kind: "材采", projectId: "p1", supplierId: "s3",
      amount: 1340000, changed: 1340000, settled: 980000, invoiced: 980000, paid: 980000, signDate: "2025-10-08", status: "履约中",
      doc: { name: "材料采购合同.pdf", pages: 8 } },
    { id: "cg04", no: "RJ-JXHT-CG-2026004", name: "电线电缆采购合同", kind: "材采", projectId: "p2", supplierId: "s2",
      amount: 720000, changed: 720000, settled: 400000, invoiced: 400000, paid: 400000, signDate: "2026-02-12", status: "履约中",
      doc: { name: "材料采购合同.pdf", pages: 8 } },
    { id: "cg05", no: "RJ-CBSY-CG-2025005", name: "铝扣板材料采购合同", kind: "材采", projectId: "p5", supplierId: "s8",
      amount: 55600, changed: 55600, settled: 0, invoiced: 0, paid: 0, signDate: "2025-12-27", status: "已签订",
      doc: { name: "材料采购合同.pdf", pages: 6 } },
    { id: "cg06", no: "RJ-CBSY-CG-2025006", name: "灯具采购合同", kind: "材采", projectId: "p5", supplierId: "s4",
      amount: 21139, changed: 21139, settled: 21138, invoiced: 21138, paid: 21138, signDate: "2025-12-22", status: "已结清",
      doc: { name: "材料采购合同.pdf", pages: 6 } },
    { id: "cg07", no: "RJ-JXHT-CG-2026007", name: "五金机电采购合同", kind: "材采", projectId: "p2", supplierId: "s4",
      amount: 230000, changed: 230000, settled: 80000, invoiced: 80000, paid: 80000, signDate: "2026-03-18", status: "履约中",
      doc: { name: "材料采购合同.pdf", pages: 6 } },
    { id: "cg08", no: "RJ-CHHY-CG-2025008", name: "防水卷材采购合同", kind: "材采", projectId: "p3", supplierId: "s1",
      amount: 335000, changed: 335000, settled: 335000, invoiced: 335000, paid: 335000, signDate: "2025-04-22", status: "已结清",
      doc: { name: "材料采购合同.pdf", pages: 6 } },
    { id: "cg09", no: "RJ-KXC-CG-2026009", name: "给排水管材采购合同", kind: "材采", projectId: "p6", supplierId: "s10",
      amount: 215306.38, changed: 215306.38, settled: 215306.38, invoiced: 215306.38, paid: 215306.38, signDate: "2026-04-09", status: "履约中",
      doc: { name: "材料采购合同.pdf", pages: 6 } },
    { id: "cg10", no: "RJ-BYJC-CG-2026010", name: "配电箱采购合同", kind: "材采", projectId: "p11", supplierId: "s4",
      amount: 10111, changed: 10111, settled: 0, invoiced: 0, paid: 0, signDate: "2026-06-09", status: "已签订",
      doc: { name: "材料采购合同.pdf", pages: 6 } },
  ];

  // ——— 资金域轻实体仓（批B：稳定 id 够蓝链，金额 mock、与 contracts 已付/收款口径大体对齐）———
  // 付款申请 payApplies：8 业务类型；invoiceState 驱动默认视图「待追回发票」；status 付款类三档(审批中/已审批/已付款)
  const payApplies = [
    { id: "fk01", no: "FKSQ-2026-0601", name: "泥水班组 5 月进度付款", bizType: "有合同-分包", projectId: "p1", supplierId: "s6", contractId: "fb01",
      applyAmount: 500000, approvedAmount: 500000, paidAmount: 480000, invoiceState: "已收票", status: "已付款", costName: "劳务分包费/泥水", applicant: "刘志强", applyDate: "2026-05-28", payDate: "2026-06-03" },
    { id: "fk02", no: "FKSQ-2026-0602", name: "泥水班组 6 月进度付款", bizType: "有合同-分包", projectId: "p1", supplierId: "s6", contractId: "fb01",
      applyAmount: 500000, approvedAmount: 500000, paidAmount: 500000, invoiceState: "待追回", status: "已付款", costName: "劳务分包费/泥水", applicant: "刘志强", applyDate: "2026-06-25", payDate: "2026-06-30" },
    { id: "fk03", no: "FKSQ-2026-0603", name: "瓷砖采购 5 月结算付款", bizType: "有合同-材料", projectId: "p1", supplierId: "s7", contractId: "cg01",
      applyAmount: 1200000, approvedAmount: 1000000, paidAmount: 980000, invoiceState: "已收票", status: "已付款", costName: "材料费/瓷砖", applicant: "黄伟明", applyDate: "2026-06-02", payDate: "2026-06-08" },
    { id: "fk04", no: "FKSQ-2026-0604", name: "瓷砖采购 6 月付款", bizType: "有合同-材料", projectId: "p1", supplierId: "s7", contractId: "cg01",
      applyAmount: 1000000, approvedAmount: 1000000, paidAmount: 1000000, invoiceState: "待追回", status: "已付款", costName: "材料费/瓷砖", applicant: "黄伟明", applyDate: "2026-06-22", payDate: "2026-06-28" },
    { id: "fk05", no: "FKSQ-2026-0605", name: "钢筋采购结算付款", bizType: "有合同-材料", projectId: "p1", supplierId: "s1", contractId: "cg02",
      applyAmount: 865000, approvedAmount: 865000, paidAmount: 865000, invoiceState: "已收票", status: "已付款", costName: "材料费/钢筋", applicant: "黄伟明", applyDate: "2026-05-15", payDate: "2026-05-20" },
    { id: "fk06", no: "FKSQ-2026-0606", name: "机电安装进度付款", bizType: "有合同-分包", projectId: "p2", supplierId: "s10", contractId: "fb05",
      applyAmount: 600000, approvedAmount: 600000, paidAmount: 600000, invoiceState: "已收票", status: "已付款", costName: "专业分包费/机电", applicant: "梁国栋", applyDate: "2026-06-10", payDate: "2026-06-15" },
    { id: "fk07", no: "FKSQ-2026-0607", name: "电缆采购预付款", bizType: "预付款", projectId: "p2", supplierId: "s2", contractId: "cg04",
      applyAmount: 200000, approvedAmount: 200000, paidAmount: 200000, invoiceState: "待追回", status: "已付款", costName: "材料费/电缆", applicant: "梁国栋", applyDate: "2026-03-02", payDate: "2026-03-05" },
    { id: "fk08", no: "FKSQ-2026-0608", name: "电动工具零星采购", bizType: "无合同-零星采购", projectId: "p2", supplierId: "s4", contractId: null,
      applyAmount: 12380, approvedAmount: 12380, paidAmount: 12380, invoiceState: "已收票", status: "已付款", costName: "材料费/五金杂项", applicant: "宋子豪", applyDate: "2026-06-11", payDate: "2026-06-12" },
    { id: "fk09", no: "FKSQ-2026-0609", name: "翠湖花园项目部管理费", bizType: "管理费", projectId: "p3", supplierId: null, contractId: null,
      applyAmount: 45000, approvedAmount: 45000, paidAmount: 0, invoiceState: "已收票", status: "已审批", costName: "间接费/项目部管理", applicant: "陈志明", applyDate: "2026-07-01", payDate: "" },
    { id: "fk10", no: "FKSQ-2026-0610", name: "车陂大楼垃圾清运费", bizType: "项目费用", projectId: "p5", supplierId: null, contractId: null,
      applyAmount: 86000, approvedAmount: 80000, paidAmount: 0, invoiceState: "待追回", status: "已审批", costName: "人工费/垃圾外运", applicant: "周维", applyDate: "2026-07-03", payDate: "" },
    { id: "fk11", no: "FKSQ-2026-0611", name: "泥水班组 7 月进度付款", bizType: "有合同-分包", projectId: "p1", supplierId: "s6", contractId: "fb01",
      applyAmount: 300000, approvedAmount: 0, paidAmount: 0, invoiceState: "待追回", status: "审批中", costName: "劳务分包费/泥水", applicant: "刘志强", applyDate: "2026-07-08", payDate: "" },
    { id: "fk12", no: "FKSQ-2026-0612", name: "公司办公室房租(Q3)", bizType: "公司付款", projectId: null, supplierId: null, contractId: null,
      applyAmount: 68000, approvedAmount: 68000, paidAmount: 0, invoiceState: "已收票", status: "已审批", costName: "公司费用/房租", applicant: "行政部", applyDate: "2026-07-05", payDate: "" },
  ];

  // 收款登记 receipts（收入侧：甲方回款，关联施工合同；与 contracts.paid(施工=累计收款) 对齐）
  const receipts = [
    { id: "sk01", no: "SK-2026-001", projectId: "p1", contractId: "sg01", amount: 15000000, method: "银行转账", date: "2026-03-30", payer: "合和地产集团" },
    { id: "sk02", no: "SK-2026-002", projectId: "p1", contractId: "sg01", amount: 10367027, method: "银行转账", date: "2026-05-30", payer: "合和地产集团" },
    { id: "sk03", no: "SK-2026-003", projectId: "p2", contractId: "sg02", amount: 9800000, method: "银行转账", date: "2026-05-18", payer: "锦绣置业有限公司" },
    { id: "sk04", no: "SK-2026-004", projectId: "p5", contractId: "sg05", amount: 8600000, method: "银行承兑", date: "2026-06-12", payer: "天河城建投资" },
    { id: "sk05", no: "SK-2026-005", projectId: "p3", contractId: "sg03", amount: 9100000, method: "银行转账", date: "2026-04-22", payer: "翠湖投资" },
    { id: "sk06", no: "SK-2026-006", projectId: "p6", contractId: "sg06", amount: 3100000, method: "银行转账", date: "2026-06-28", payer: "广州开发区建设集团" },
    { id: "sk07", no: "SK-2026-007", projectId: "p8", contractId: "sg08", amount: 2400000, method: "银行转账", date: "2026-06-05", payer: "利丰置业" },
    { id: "sk08", no: "SK-2026-008", projectId: "p11", contractId: "sg11", amount: 1200000, method: "银行转账", date: "2026-06-30", payer: "白云机场建设" },
  ];

  // 开票申请 invApplies（收入侧起点：我方给甲方开票；与 contracts.invoiced(施工=累计开票) 大体对齐）
  const invApplies = [
    { id: "kp01", no: "KPSQ-2026-001", projectId: "p1", contractId: "sg01", amount: 15000000, tax: 1238532.11, rate: "9%", date: "2026-03-25", status: "已开票" },
    { id: "kp02", no: "KPSQ-2026-002", projectId: "p1", contractId: "sg01", amount: 10800000, tax: 891743.12, rate: "9%", date: "2026-05-25", status: "已开票" },
    { id: "kp03", no: "KPSQ-2026-003", projectId: "p2", contractId: "sg02", amount: 9800000, tax: 809174.31, rate: "9%", date: "2026-05-12", status: "已开票" },
    { id: "kp04", no: "KPSQ-2026-004", projectId: "p5", contractId: "sg05", amount: 8600000, tax: 710091.74, rate: "9%", date: "2026-06-08", status: "已开票" },
    { id: "kp05", no: "KPSQ-2026-005", projectId: "p3", contractId: "sg03", amount: 9200000, tax: 759633.03, rate: "9%", date: "2026-04-15", status: "已开票" },
    { id: "kp06", no: "KPSQ-2026-006", projectId: "p1", contractId: "sg01", amount: 800000, tax: 66055.05, rate: "9%", date: "2026-07-06", status: "已审批" },
    { id: "kp07", no: "KPSQ-2026-007", projectId: "p6", contractId: "sg06", amount: 1200000, tax: 99082.57, rate: "9%", date: "2026-07-09", status: "审批中" },
  ];

  // 往来收付 currents（非合同类往来；direction 收/付；与项目详情⑦往来口径对齐 p1 收 610万/付 595万）
  const currents = [
    { id: "wl01", no: "WLSK-2026-001", direction: "收", projectId: "p1", counterparty: "合和地产集团", amount: 4000000, method: "银行转账", date: "2026-02-10", note: "工程借款往来" },
    { id: "wl02", no: "WLSK-2026-002", direction: "收", projectId: "p1", counterparty: "广州市政集团", amount: 2100000, method: "银行转账", date: "2026-04-08", note: "代收往来" },
    { id: "wl03", no: "WLFK-2026-001", direction: "付", projectId: "p1", counterparty: "合和地产集团", amount: 3950000, method: "银行转账", date: "2026-03-15", note: "借款归还" },
    { id: "wl04", no: "WLFK-2026-002", direction: "付", projectId: "p1", counterparty: "广州市瑞航建筑工程有限公司", amount: 2000000, method: "内部转账", date: "2026-05-20", note: "公司调拨" },
    { id: "wl05", no: "WLSK-2026-003", direction: "收", projectId: "p5", counterparty: "天河城建投资", amount: 500000, method: "银行转账", date: "2026-06-01", note: "临时借支归还" },
    { id: "wl06", no: "WLFK-2026-003", direction: "付", projectId: "p2", counterparty: "锦绣置业有限公司", amount: 120000, method: "银行转账", date: "2026-06-18", note: "水电费代付" },
    { id: "wl07", no: "WLSK-2026-004", direction: "收", projectId: null, counterparty: "广州亚运城开发", amount: 260000, method: "银行转账", date: "2026-06-25", note: "保证金退回" },
    { id: "wl08", no: "WLFK-2026-004", direction: "付", projectId: null, counterparty: "广州开发区建设集团", amount: 180000, method: "银行转账", date: "2026-07-02", note: "投标保证金" },
  ];

  // 支付记录 payRecords（实付流水终点；对应已付款的付款申请，列样=P1 项目详情⑧）
  const payRecords = [
    { id: "zf01", no: "ZF-2026-0601", date: "2026-06-03", amount: 480000, method: "银行转账", payApplyId: "fk01", projectId: "p1", supplierId: "s6", account: "陈家泥水班组", bank: "农业银行广州白云支行", bankNo: "6228 4801 2233 9900" },
    { id: "zf02", no: "ZF-2026-0602", date: "2026-06-30", amount: 500000, method: "银行转账", payApplyId: "fk02", projectId: "p1", supplierId: "s6", account: "陈家泥水班组", bank: "农业银行广州白云支行", bankNo: "6228 4801 2233 9900" },
    { id: "zf03", no: "ZF-2026-0603", date: "2026-06-08", amount: 980000, method: "银行转账", payApplyId: "fk03", projectId: "p1", supplierId: "s7", account: "广东宏宇陶瓷有限公司", bank: "工商银行佛山禅城支行", bankNo: "6222 0203 1122 5566" },
    { id: "zf04", no: "ZF-2026-0604", date: "2026-06-28", amount: 1000000, method: "银行承兑", payApplyId: "fk04", projectId: "p1", supplierId: "s7", account: "广东宏宇陶瓷有限公司", bank: "工商银行佛山禅城支行", bankNo: "6222 0203 1122 5566" },
    { id: "zf05", no: "ZF-2026-0605", date: "2026-05-20", amount: 865000, method: "银行转账", payApplyId: "fk05", projectId: "p1", supplierId: "s1", account: "广州市大板东建材有限公司", bank: "中国银行广州天河支行", bankNo: "6217 8500 1234 5678" },
    { id: "zf06", no: "ZF-2026-0606", date: "2026-06-15", amount: 600000, method: "银行转账", payApplyId: "fk06", projectId: "p2", supplierId: "s10", account: "恒安机电安装工程有限公司", bank: "招商银行广州番禺支行", bankNo: "6225 8802 7788 1122" },
    { id: "zf07", no: "ZF-2026-0607", date: "2026-03-05", amount: 200000, method: "银行转账", payApplyId: "fk07", projectId: "p2", supplierId: "s2", account: "花城珠江电线电缆有限公司", bank: "工商银行广州越秀支行", bankNo: "6222 0202 8888 4321" },
    { id: "zf08", no: "ZF-2026-0608", date: "2026-06-12", amount: 12380, method: "对公转账", payApplyId: "fk08", projectId: "p2", supplierId: "s4", account: "穗建五金机电经营部", bank: "农业银行广州海珠支行", bankNo: "6228 4800 5566 7788" },
  ];

  // 费用报销 reimburses（个人报销；projectId=null 即公司/个人开支，连批E 房租线）
  const reimburses = [
    { id: "bx01", no: "BX-2026-0601", applicant: "刘志强", projectId: "p1", category: "差旅费", amount: 3860, date: "2026-06-20", status: "已付款", note: "甲方对接出差" },
    { id: "bx02", no: "BX-2026-0602", applicant: "黄伟明", projectId: "p1", category: "招待费", amount: 2400, date: "2026-06-25", status: "已审批", note: "监理例会" },
    { id: "bx03", no: "BX-2026-0603", applicant: "宋子豪", projectId: "p2", category: "办公费", amount: 860, date: "2026-07-01", status: "已付款", note: "项目部耗材" },
    { id: "bx04", no: "BX-2026-0604", applicant: "周维", projectId: "p5", category: "交通费", amount: 1240, date: "2026-07-03", status: "审批中", note: "工地往返" },
    { id: "bx05", no: "BX-2026-0605", applicant: "行政部", projectId: null, category: "水电费", amount: 5600, date: "2026-07-05", status: "已审批", note: "公司办公室" },
    { id: "bx06", no: "BX-2026-0606", applicant: "陈志明", projectId: "p3", category: "零星材料", amount: 980, date: "2026-07-08", status: "审批中", note: "收尾补料" },
  ];

  // ——— 批C 轻实体仓：目标成本 + 主合同生命周期 + 分包单据（稳定 id 够蓝链，金额 mock）———
  // 目标成本（预算——四级金额链源头）：每项目 1 份；树表明细在 targetCostTrees[costId]
  const targetCosts = [
    { id: "tc1", name: "合和新城目标成本", projectId: "p1", incomeAmount: 32388422, plannedProfit: 4988422, signedAmount: 8945000, incTotal: 27400000, excTotal: 25137615, tax: 2262385 },
    { id: "tc2", name: "锦绣华庭目标成本", projectId: "p2", incomeAmount: 18600000, plannedProfit: 2400000, signedAmount: 4780000, incTotal: 16200000, excTotal: 14862385, tax: 1337615 },
    { id: "tc3", name: "翠湖花园目标成本", projectId: "p3", incomeAmount: 9800000, plannedProfit: 1000000, signedAmount: 515000, incTotal: 8800000, excTotal: 8073394, tax: 726606 },
    { id: "tc5", name: "车陂商业大楼目标成本", projectId: "p5", incomeAmount: 15800000, plannedProfit: 1900000, signedAmount: 837181, incTotal: 13900000, excTotal: 12752294, tax: 1147706 },
  ];
  // 目标成本树（多级清单：分部→子项→叶子；叶子才有 单价；q/p/a=预算 量/单价/合价，sq/sa=合同已签 量/合价，
  // ra=实际成本，pa=实际支付；非叶子行金额=children 聚合，由页面现算，勿在此存总）
  const tcLeaf = (no, name, unit, q, p, sq, ra, pa) => ({ no, name, unit, q, p, a: Math.round(q * p), sq, sa: Math.round(sq * p), ra, pa, leaf: true });
  const targetCostTrees = {
    tc1: [
      { no: "1", name: "主体结构工程", children: [
        { no: "1.1", name: "钢筋工程", children: [
          tcLeaf("1.1.1", "HRB400 螺纹钢 Φ12 制安", "吨", 320, 4350, 290, 1264000, 865000),
          tcLeaf("1.1.2", "HRB400 螺纹钢 Φ25 制安", "吨", 180, 4280, 150, 520000, 380000),
        ] },
        { no: "1.2", name: "混凝土工程", children: [
          tcLeaf("1.2.1", "C30 商品混凝土浇筑", "m³", 2600, 520, 1900, 980000, 980000),
          tcLeaf("1.2.2", "C35 商品混凝土浇筑", "m³", 800, 545, 420, 226000, 208000),
        ] },
        { no: "1.3", name: "模板工程", children: [
          tcLeaf("1.3.1", "组合钢模板安拆", "㎡", 18000, 62, 12800, 760000, 700000),
        ] },
      ] },
      { no: "2", name: "装饰装修工程", children: [
        { no: "2.1", name: "墙地砖工程", children: [
          tcLeaf("2.1.1", "墙砖铺贴（含瓷砖）", "㎡", 26000, 128, 17800, 2150000, 1980000),
          tcLeaf("2.1.2", "地砖铺贴（含瓷砖）", "㎡", 21000, 112, 14200, 1460000, 1320000),
        ] },
        { no: "2.2", name: "涂饰与吊顶", children: [
          tcLeaf("2.2.1", "内墙乳胶漆", "㎡", 30000, 28, 0, 0, 0),
          tcLeaf("2.2.2", "铝扣板吊顶", "㎡", 5200, 96, 5200, 0, 0),
        ] },
      ] },
      { no: "3", name: "安装工程", children: [
        { no: "3.1", name: "给排水", children: [tcLeaf("3.1.1", "PPR/PVC 管道安装", "m", 26000, 36, 0, 0, 0)] },
        { no: "3.2", name: "电气", children: [tcLeaf("3.2.1", "电线电缆敷设", "m", 68000, 18, 40000, 400000, 400000)] },
      ] },
      { no: "4", name: "措施及其他", children: [
        tcLeaf("4.1", "脚手架搭设", "㎡", 22000, 34, 22000, 266692, 266692),
        tcLeaf("4.2", "垃圾清运", "车", 300, 380, 0, 86000, 0),
      ] },
    ],
  };
  // 甲方变洽签（变更单四档：草稿/已上报/已打回/已签证；已签证才进变更后合同额）
  const ownerChanges = [
    { id: "oc1", no: "BQ-2026-001", name: "锦绣华庭材料涨价签证", projectId: "p2", contractId: "sg02", type: "签证", incAmount: 320000, excAmount: 293578, appliedAmount: 293578, date: "2026-03-10", status: "已签证" },
    { id: "oc2", no: "BQ-2026-002", name: "翠湖花园园建变更", projectId: "p3", contractId: "sg03", type: "变更", incAmount: 120000, excAmount: 110092, appliedAmount: 110092, date: "2026-04-02", status: "已签证" },
    { id: "oc3", no: "BQ-2026-003", name: "亚运城C1户型调整洽商", projectId: "p7", contractId: "sg07", type: "洽商", incAmount: 1200000, excAmount: 1100917, appliedAmount: 1100917, date: "2025-02-18", status: "已签证" },
    { id: "oc4", no: "BQ-2026-004", name: "领秀海外立面变更", projectId: "p9", contractId: "sg09", type: "变更", incAmount: 400000, excAmount: 366972, appliedAmount: 366972, date: "2025-06-20", status: "已签证" },
    { id: "oc5", no: "BQ-2026-005", name: "未来印象公区增项", projectId: "p10", contractId: "sg10", type: "变更", incAmount: 600000, excAmount: 550459, appliedAmount: 550459, date: "2024-05-12", status: "已签证" },
    { id: "oc6", no: "BQ-2026-006", name: "合和新城景观桥签证", projectId: "p1", contractId: "sg01", type: "签证", incAmount: 860000, excAmount: 788991, appliedAmount: 0, date: "2026-07-02", status: "已上报" },
    { id: "oc7", no: "BQ-2026-007", name: "车陂大楼幕墙洽商", projectId: "p5", contractId: "sg05", type: "洽商", incAmount: 420000, excAmount: 385321, appliedAmount: 0, date: "2026-07-06", status: "草稿" },
    { id: "oc8", no: "BQ-2026-008", name: "科学城地下室变更", projectId: "p6", contractId: "sg06", type: "变更", incAmount: 260000, excAmount: 238532, appliedAmount: 238532, date: "2026-06-18", status: "已打回" },
  ];
  // 甲方报量（月度报量：申报产值→甲方审定；累计收入来源）
  const ownerReports = [
    { id: "or1", no: "BL-2026-06-01", projectId: "p1", contractId: "sg01", period: "2026-06", reportedAmount: 3200000, auditedAmount: 3050000, date: "2026-06-28", status: "已审定" },
    { id: "or2", no: "BL-2026-05-01", projectId: "p1", contractId: "sg01", period: "2026-05", reportedAmount: 2900000, auditedAmount: 2900000, date: "2026-05-28", status: "已审定" },
    { id: "or3", no: "BL-2026-06-02", projectId: "p2", contractId: "sg02", period: "2026-06", reportedAmount: 1500000, auditedAmount: 1420000, date: "2026-06-30", status: "已审定" },
    { id: "or4", no: "BL-2026-06-03", projectId: "p5", contractId: "sg05", period: "2026-06", reportedAmount: 1800000, auditedAmount: 0, date: "2026-07-02", status: "已申报" },
    { id: "or5", no: "BL-2026-06-04", projectId: "p6", contractId: "sg06", period: "2026-06", reportedAmount: 900000, auditedAmount: 860000, date: "2026-06-29", status: "已审定" },
    { id: "or6", no: "BL-2026-07-01", projectId: "p1", contractId: "sg01", period: "2026-07", reportedAmount: 2600000, auditedAmount: 0, date: "2026-07-09", status: "已申报" },
    { id: "or7", no: "BL-2026-06-05", projectId: "p8", contractId: "sg08", period: "2026-06", reportedAmount: 760000, auditedAmount: 760000, date: "2026-06-27", status: "已审定" },
    { id: "or8", no: "BL-2026-06-06", projectId: "p11", contractId: "sg11", period: "2026-06", reportedAmount: 420000, auditedAmount: 400000, date: "2026-06-30", status: "已审定" },
  ];
  // 竣工验收 · 保修到期确认单（阶段流转触发器）
  const acceptances = [
    { id: "ac1", no: "JGYS-2025-001", type: "竣工验收", name: "亚运城C1标段竣工验收", projectId: "p7", contractId: "sg07", date: "2025-12-18", status: "已验收", estimate: 21800000 },
    { id: "ac2", no: "JGYS-2024-002", type: "竣工验收", name: "未来印象小区竣工验收", projectId: "p10", contractId: "sg10", date: "2024-12-20", status: "已验收", estimate: 9800000 },
    { id: "ac3", no: "BXQR-2026-001", type: "保修到期确认", name: "未来印象小区保修到期确认", projectId: "p10", contractId: "sg10", date: "2026-12-20", status: "保修中", estimate: 196000 },
    { id: "ac4", no: "JGYS-2026-003", type: "竣工验收", name: "领秀海5-6号楼竣工验收", projectId: "p9", contractId: "sg09", date: "2026-06-30", status: "验收中", estimate: 18600000 },
    { id: "ac5", no: "BXQR-2026-002", type: "保修到期确认", name: "亚运城C1保修到期确认", projectId: "p7", contractId: "sg07", date: "2027-12-18", status: "保修中", estimate: 436000 },
    { id: "ac6", no: "JGYS-2026-004", type: "竣工验收", name: "翠湖花园竣工预验收", projectId: "p3", contractId: "sg03", date: "2026-08-15", status: "验收中", estimate: 9920000 },
  ];
  // 最终结算（与甲方）
  const finalSettles = [
    { id: "fs1", no: "ZJS-2026-001", name: "亚运城C1标段最终结算", projectId: "p7", contractId: "sg07", amount: 21800000, date: "2026-03-20", status: "已审定" },
    { id: "fs2", no: "ZJS-2025-002", name: "未来印象小区最终结算", projectId: "p10", contractId: "sg10", amount: 9800000, date: "2025-04-15", status: "已审定" },
    { id: "fs3", no: "ZJS-2026-003", name: "领秀海5-6号楼最终结算", projectId: "p9", contractId: "sg09", amount: 18600000, date: "2026-07-01", status: "已报审" },
    { id: "fs4", no: "ZJS-2026-004", name: "翠湖花园最终结算(编制)", projectId: "p3", contractId: "sg03", amount: 9920000, date: "", status: "编制中" },
  ];
  // 甲方罚扣单（甲方对我方罚扣，冲减收入）
  const ownerPenalties = [
    { id: "op1", no: "FK-2026-001", reason: "工期延误罚款", projectId: "p4", contractId: "sg04", amount: 120000, date: "2026-05-20", status: "已确认" },
    { id: "op2", no: "FK-2026-002", reason: "安全文明施工扣款", projectId: "p1", contractId: "sg01", amount: 36000, date: "2026-06-12", status: "已确认" },
    { id: "op3", no: "FK-2026-003", reason: "成品保护不到位扣款", projectId: "p2", contractId: "sg02", amount: 18000, date: "2026-06-25", status: "申诉中" },
    { id: "op4", no: "FK-2026-004", reason: "验收整改逾期罚款", projectId: "p9", contractId: "sg09", amount: 52000, date: "2026-07-03", status: "申诉中" },
    { id: "op5", no: "FK-2025-005", reason: "噪音投诉处罚转嫁", projectId: "p7", contractId: "sg07", amount: 8000, date: "2025-10-11", status: "已确认" },
  ];
  // 分包变洽签（对分供方；四档同甲方）
  const subChanges = [
    { id: "sc1", no: "FBQ-2026-001", type: "增项", projectId: "p1", contractId: "fb01", supplierId: "s6", amount: 186000, area: "320 ㎡", audited: 178000, date: "2026-04-06", status: "已签证" },
    { id: "sc2", no: "FBQ-2026-002", type: "签证", projectId: "p1", contractId: "cg01", supplierId: "s7", amount: 92000, area: "—", audited: 88000, date: "2026-05-15", status: "已签证" },
    { id: "sc3", no: "FBQ-2026-003", type: "洽商", projectId: "p2", contractId: "fb05", supplierId: "s10", amount: 64000, area: "—", audited: 0, date: "2026-07-01", status: "已上报" },
    { id: "sc4", no: "FBQ-2026-004", type: "增项", projectId: "p1", contractId: "fb02", supplierId: "s8", amount: 45000, area: "600 ㎡", audited: 0, date: "2026-07-05", status: "草稿" },
    { id: "sc5", no: "FBQ-2026-005", type: "签证", projectId: "p6", contractId: "fb08", supplierId: "s6", amount: 28000, area: "150 ㎡", audited: 0, date: "2026-06-30", status: "已打回" },
    { id: "sc6", no: "FBQ-2025-006", type: "增项", projectId: "p9", contractId: "fb09", supplierId: "s6", amount: 36000, area: "220 ㎡", audited: 36000, date: "2025-08-12", status: "已签证" },
  ];
  // 分包结算（结算单关联分包/材采合同；付款申请引用它）
  const subSettles = [
    { id: "ss1", no: "FBJS-2026-001", name: "泥水班组 6 月进度结算", projectId: "p1", contractId: "fb01", supplierId: "s6", type: "进度结算", amount: 1240000, date: "2026-06-25", status: "已确认" },
    { id: "ss2", no: "FBJS-2026-002", name: "瓷砖采购 5 月结算", projectId: "p1", contractId: "cg01", supplierId: "s7", type: "到货结算", amount: 2150000, date: "2026-05-28", status: "已确认" },
    { id: "ss3", no: "FBJS-2026-003", name: "屋面防水最终结算", projectId: "p1", contractId: "fb03", supplierId: "s5", type: "最终结算", amount: 560000, date: "2026-02-10", status: "已确认" },
    { id: "ss4", no: "FBJS-2026-004", name: "机电安装 6 月进度结算", projectId: "p2", contractId: "fb05", supplierId: "s10", type: "进度结算", amount: 640000, date: "2026-06-28", status: "已确认" },
    { id: "ss5", no: "FBJS-2026-005", name: "钢筋采购结算", projectId: "p1", contractId: "cg02", supplierId: "s1", type: "到货结算", amount: 1264000, date: "2026-05-12", status: "已确认" },
    { id: "ss6", no: "FBJS-2026-006", name: "脚手架进度结算", projectId: "p5", contractId: "fb06", supplierId: "s9", type: "进度结算", amount: 266692, date: "2026-06-15", status: "已确认" },
    { id: "ss7", no: "FBJS-2026-007", name: "泥水班组 7 月进度结算(待确认)", projectId: "p1", contractId: "fb01", supplierId: "s6", type: "进度结算", amount: 380000, date: "2026-07-08", status: "待确认" },
    { id: "ss8", no: "FBJS-2026-008", name: "领秀海泥水最终结算", projectId: "p9", contractId: "fb09", supplierId: "s6", type: "最终结算", amount: 890000, date: "2025-09-30", status: "已确认" },
  ];
  // 项目罚扣（对分供方罚款/扣款，结算时抵扣；连工资「空鼓扣罚」口径）
  const projPenalties = [
    { id: "pp1", no: "XMFK-2026-001", reason: "空鼓扣罚 · 3 处", projectId: "p1", contractId: "fb01", supplierId: "s6", amount: 600, date: "2026-04-18", status: "已抵扣" },
    { id: "pp2", no: "XMFK-2026-002", reason: "未收尾扣款", projectId: "p1", contractId: "fb01", supplierId: "s6", amount: 600, date: "2026-04-30", status: "已抵扣" },
    { id: "pp3", no: "XMFK-2026-003", reason: "材料破损索赔", projectId: "p1", contractId: "cg01", supplierId: "s7", amount: 12000, date: "2026-05-22", status: "已抵扣" },
    { id: "pp4", no: "XMFK-2026-004", reason: "安全违规罚款", projectId: "p2", contractId: "fb05", supplierId: "s10", amount: 5000, date: "2026-06-20", status: "待抵扣" },
    { id: "pp5", no: "XMFK-2026-005", reason: "工期滞后罚款", projectId: "p6", contractId: "fb08", supplierId: "s6", amount: 8000, date: "2026-07-02", status: "待抵扣" },
    { id: "pp6", no: "XMFK-2026-006", reason: "成品保护赔偿", projectId: "p5", contractId: "fb06", supplierId: "s9", amount: 3200, date: "2026-06-08", status: "已抵扣" },
    { id: "pp7", no: "XMFK-2026-007", reason: "空鼓扣罚 · 2 处", projectId: "p9", contractId: "fb09", supplierId: "s6", amount: 400, date: "2025-09-10", status: "已抵扣" },
  ];

  // 送货单归档库（批D §3，原 P3）：核对完成后归档的送货单，按 项目→分供方 组织；supplierId=null → 未区分分供方（待纠错归并）
  // ocrCompany = OCR/文件夹推断的原始公司名（可能与分供方库不完全一致，供模糊纠错一键替换）
  const deliveryArchives = [
    { id: "a1", name: "大板东-20260330.pdf", projectId: "p1", supplierId: "s1", ocrCompany: "广州市大板东建材有限公司", no: "DH0330", date: "2026-03-30", material: "HRB400 螺纹钢 Φ12 / 120 吨", amount: 477600 },
    { id: "a2", name: "大板东-20260512.pdf", projectId: "p1", supplierId: "s1", ocrCompany: "广州市大板东建材有限公司", no: "DH0512", date: "2026-05-12", material: "HRB400 螺纹钢 Φ12 / 170 吨", amount: 676600 },
    { id: "a3", name: "汇丰水泥-0406.jpg", projectId: "p1", supplierId: "s3", ocrCompany: "汇丰水泥制品有限公司", no: "DH0406", date: "2026-04-06", material: "C30 商砼 / 900 m³", amount: 415800 },
    { id: "a4", name: "宏宇陶瓷-0508.pdf", projectId: "p1", supplierId: "s7", ocrCompany: "广东宏宇陶瓷有限公司", no: "DH0508", date: "2026-05-08", material: "墙砖 300×600 / 8900 ㎡", amount: 1139200 },
    { id: "a5", name: "宏宇陶瓷-0610.pdf", projectId: "p1", supplierId: "s7", ocrCompany: "广东宏宇陶瓷有限公司", no: "DH0610", date: "2026-06-10", material: "地砖 800×800 / 7100 ㎡", amount: 795200 },
    { id: "a6", name: "送货单_扫描_022.jpg", projectId: "p1", supplierId: null, ocrCompany: "大板东建材商行", no: "—", date: "2026-06-21", material: "地砖阳角条 / 30 支", amount: 360 },
    { id: "a7", name: "未命名_06.pdf", projectId: "p1", supplierId: null, ocrCompany: "宏宇陶瓷（佛山）", no: "—", date: "2026-06-22", material: "填缝剂 / 40 袋", amount: 600 },
    { id: "a8", name: "花城电缆-0301.jpg", projectId: "p2", supplierId: "s2", ocrCompany: "花城珠江电线电缆有限公司", no: "DH0301", date: "2026-03-01", material: "电缆 YJV 3×25 / 5000 米", amount: 230000 },
    { id: "a9", name: "穗建五金-0610.pdf", projectId: "p2", supplierId: "s4", ocrCompany: "穗建五金机电经营部", no: "S06103", date: "2026-06-10", material: "镀锌钢管 DN50 等 3 项", amount: 4180 },
    { id: "a10", name: "大板东防水-0330.pdf", projectId: "p3", supplierId: "s1", ocrCompany: "广州市大板东建材有限公司", no: "DH0330B", date: "2026-03-30", material: "防水卷材 SBS / 1200 卷", amount: 384000 },
  ];

  // ——— 批D 轻实体仓：乙供材单据（红圈05）+ 甲供材整域（红圈06）（稳定 id 够蓝链，金额/数量 mock）———
  // 下料单（要料计划）：默认视图「未完全到货」；remain = plan - arrived（计算列）
  const matRequisitions = [
    { id: "xl01", no: "XL-2026-001", projectId: "p1", material: "HRB400 螺纹钢 Φ12", planQty: 320, arrivedQty: 290, unit: "吨", applicant: "赵铁柱", date: "2026-03-05", status: "未完全到货" },
    { id: "xl02", no: "XL-2026-002", projectId: "p1", material: "墙砖 300×600（含瓷砖）", planQty: 26000, arrivedQty: 17800, unit: "㎡", applicant: "虞建华", date: "2026-04-10", status: "未完全到货" },
    { id: "xl03", no: "XL-2026-003", projectId: "p1", material: "C30 商品混凝土", planQty: 2600, arrivedQty: 1900, unit: "m³", applicant: "匡志强", date: "2026-03-20", status: "未完全到货" },
    { id: "xl04", no: "XL-2026-004", projectId: "p2", material: "电缆 YJV 3×25", planQty: 5000, arrivedQty: 5000, unit: "米", applicant: "周伟峰", date: "2026-02-15", status: "已齐套" },
    { id: "xl05", no: "XL-2026-005", projectId: "p1", material: "地砖 800×800（含瓷砖）", planQty: 21000, arrivedQty: 14200, unit: "㎡", applicant: "虞建华", date: "2026-04-12", status: "未完全到货" },
    { id: "xl06", no: "XL-2026-006", projectId: "p5", material: "铝扣板吊顶", planQty: 5200, arrivedQty: 0, unit: "㎡", applicant: "周维", date: "2026-06-01", status: "未完全到货" },
    { id: "xl07", no: "XL-2026-007", projectId: "p3", material: "防水卷材 SBS", planQty: 1200, arrivedQty: 1200, unit: "卷", applicant: "郑明", date: "2026-03-30", status: "已齐套" },
  ];
  // 材料到货（入库）：关联下料单/采购合同/仓库；status 待入库/已入库
  const matArrivals = [
    { id: "dh01", no: "DH-2026-0601", projectId: "p1", contractId: "cg02", supplierId: "s1", requisitionId: "xl01", material: "HRB400 螺纹钢 Φ12", qty: 120, unit: "吨", amount: 477600, warehouse: "中心仓", date: "2026-03-30", receiver: "赵铁柱", status: "已入库" },
    { id: "dh02", no: "DH-2026-0602", projectId: "p1", contractId: "cg02", supplierId: "s1", requisitionId: "xl01", material: "HRB400 螺纹钢 Φ12", qty: 170, unit: "吨", amount: 676600, warehouse: "中心仓", date: "2026-05-12", receiver: "赵铁柱", status: "已入库" },
    { id: "dh03", no: "DH-2026-0603", projectId: "p1", contractId: "cg01", supplierId: "s7", requisitionId: "xl02", material: "墙砖 300×600", qty: 8900, unit: "㎡", amount: 1139200, warehouse: "合和新城现场仓", date: "2026-05-08", receiver: "虞建华", status: "已入库" },
    { id: "dh04", no: "DH-2026-0604", projectId: "p1", contractId: "cg03", supplierId: "s3", requisitionId: "xl03", material: "C30 商品混凝土", qty: 900, unit: "m³", amount: 415800, warehouse: "中心仓", date: "2026-04-06", receiver: "匡志强", status: "已入库" },
    { id: "dh05", no: "DH-2026-0605", projectId: "p2", contractId: "cg04", supplierId: "s2", requisitionId: "xl04", material: "电缆 YJV 3×25", qty: 5000, unit: "米", amount: 230000, warehouse: "中心仓", date: "2026-03-01", receiver: "周伟峰", status: "已入库" },
    { id: "dh06", no: "DH-2026-0606", projectId: "p1", contractId: "cg01", supplierId: "s7", requisitionId: "xl05", material: "地砖 800×800", qty: 7100, unit: "㎡", amount: 795200, warehouse: "合和新城现场仓", date: "2026-06-10", receiver: "虞建华", status: "待入库" },
    { id: "dh07", no: "DH-2026-0607", projectId: "p3", contractId: "cg08", supplierId: "s1", requisitionId: "xl07", material: "防水卷材 SBS", qty: 1200, unit: "卷", amount: 384000, warehouse: "中心仓", date: "2026-03-30", receiver: "郑明", status: "已入库" },
  ];
  // 材料领用（出库）：项目/仓库/领用人/用途
  const matUses = [
    { id: "ly01", no: "LY-2026-0601", projectId: "p1", warehouse: "中心仓", material: "HRB400 螺纹钢 Φ12", qty: 110, unit: "吨", receiver: "赵铁柱", useFor: "3 号楼主体钢筋", date: "2026-04-02" },
    { id: "ly02", no: "LY-2026-0602", projectId: "p1", warehouse: "合和新城现场仓", material: "墙砖 300×600", qty: 8600, unit: "㎡", receiver: "虞建华", useFor: "1-2 号楼墙面", date: "2026-05-15" },
    { id: "ly03", no: "LY-2026-0603", projectId: "p1", warehouse: "中心仓", material: "C30 商品混凝土", qty: 880, unit: "m³", receiver: "匡志强", useFor: "3 号楼梁板", date: "2026-04-10" },
    { id: "ly04", no: "LY-2026-0604", projectId: "p2", warehouse: "中心仓", material: "电缆 YJV 3×25", qty: 3000, unit: "米", receiver: "周伟峰", useFor: "南区强电", date: "2026-03-20" },
    { id: "ly05", no: "LY-2026-0605", projectId: "p1", warehouse: "合和新城现场仓", material: "地砖 800×800", qty: 6800, unit: "㎡", receiver: "虞建华", useFor: "1-2 号楼地面", date: "2026-06-18" },
    { id: "ly06", no: "LY-2026-0606", projectId: "p3", warehouse: "中心仓", material: "防水卷材 SBS", qty: 1100, unit: "卷", receiver: "郑明", useFor: "屋面防水", date: "2026-04-05" },
  ];
  // 材料采购结算：关联采购合同/结算金额；status 待确认/已确认
  const matSettles = [
    { id: "mjs01", no: "CGJS-2026-001", name: "钢筋采购结算", projectId: "p1", contractId: "cg02", supplierId: "s1", amount: 1264000, date: "2026-05-12", status: "已确认" },
    { id: "mjs02", no: "CGJS-2026-002", name: "瓷砖采购 5 月结算", projectId: "p1", contractId: "cg01", supplierId: "s7", amount: 2150000, date: "2026-05-28", status: "已确认" },
    { id: "mjs03", no: "CGJS-2026-003", name: "商砼采购结算", projectId: "p1", contractId: "cg03", supplierId: "s3", amount: 980000, date: "2026-06-08", status: "已确认" },
    { id: "mjs04", no: "CGJS-2026-004", name: "电缆采购结算", projectId: "p2", contractId: "cg04", supplierId: "s2", amount: 400000, date: "2026-06-15", status: "已确认" },
    { id: "mjs05", no: "CGJS-2026-005", name: "防水卷材结算", projectId: "p3", contractId: "cg08", supplierId: "s1", amount: 335000, date: "2026-04-22", status: "已确认" },
    { id: "mjs06", no: "CGJS-2026-006", name: "五金机电结算（待确认）", projectId: "p2", contractId: "cg07", supplierId: "s4", amount: 80000, date: "2026-07-05", status: "待确认" },
  ];
  // 库存盘点：仓库/盘点人/盘点项数/盈亏金额/生效状态
  const stockChecks = [
    { id: "pd01", no: "PD-2026-Q2-01", warehouse: "中心仓", checker: "黄伟明", itemCount: 42, diffAmount: -3600, date: "2026-06-30", status: "已生效" },
    { id: "pd02", no: "PD-2026-Q2-02", warehouse: "合和新城现场仓", checker: "虞建华", itemCount: 18, diffAmount: 0, date: "2026-06-30", status: "已生效" },
    { id: "pd03", no: "PD-2026-Q1-01", warehouse: "中心仓", checker: "黄伟明", itemCount: 38, diffAmount: 1200, date: "2026-03-31", status: "已生效" },
    { id: "pd04", no: "PD-2026-Q3-01", warehouse: "中心仓", checker: "黄伟明", itemCount: 45, diffAmount: 0, date: "2026-07-08", status: "草稿" },
  ];
  // —— 甲供材（红圈06 整域，甲方供货、无采购合同；供货方=项目甲方）——
  // 甲供材总控量：项目/材料/总控量/到货/已用；remain 现算
  const omTotals = [
    { id: "jz01", no: "ZK-2026-001", projectId: "p1", material: "甲供电梯（三菱）", unit: "台", totalQty: 6, arrivedQty: 4, usedQty: 2, party: "合和地产集团" },
    { id: "jz02", no: "ZK-2026-002", projectId: "p1", material: "甲供铝合金门窗", unit: "㎡", totalQty: 8000, arrivedQty: 5200, usedQty: 4800, party: "合和地产集团" },
    { id: "jz03", no: "ZK-2026-003", projectId: "p2", material: "甲供中央空调机组", unit: "台", totalQty: 12, arrivedQty: 8, usedQty: 6, party: "锦绣置业有限公司" },
    { id: "jz04", no: "ZK-2026-004", projectId: "p5", material: "甲供幕墙玻璃", unit: "㎡", totalQty: 3200, arrivedQty: 1200, usedQty: 800, party: "天河城建投资" },
    { id: "jz05", no: "ZK-2026-005", projectId: "p1", material: "甲供智能化设备", unit: "套", totalQty: 1, arrivedQty: 0, usedQty: 0, party: "合和地产集团" },
  ];
  // 甲供材下料单
  const omRequisitions = [
    { id: "jl01", no: "JXL-2026-001", projectId: "p1", material: "甲供铝合金门窗", planQty: 5200, unit: "㎡", applicant: "黄伟明", date: "2026-04-01", status: "已下单" },
    { id: "jl02", no: "JXL-2026-002", projectId: "p1", material: "甲供电梯（三菱）", planQty: 4, unit: "台", applicant: "黄伟明", date: "2026-03-10", status: "已下单" },
    { id: "jl03", no: "JXL-2026-003", projectId: "p2", material: "甲供中央空调机组", planQty: 8, unit: "台", applicant: "宋子豪", date: "2026-05-06", status: "已下单" },
    { id: "jl04", no: "JXL-2026-004", projectId: "p5", material: "甲供幕墙玻璃", planQty: 1200, unit: "㎡", applicant: "周维", date: "2026-06-01", status: "待下单" },
  ];
  // 甲供材到货
  const omArrivals = [
    { id: "jd01", no: "JDH-2026-001", projectId: "p1", material: "甲供铝合金门窗", qty: 3000, unit: "㎡", warehouse: "合和新城现场仓", date: "2026-05-10", receiver: "虞建华", status: "已入库" },
    { id: "jd02", no: "JDH-2026-002", projectId: "p1", material: "甲供铝合金门窗", qty: 2200, unit: "㎡", warehouse: "合和新城现场仓", date: "2026-06-08", receiver: "虞建华", status: "已入库" },
    { id: "jd03", no: "JDH-2026-003", projectId: "p1", material: "甲供电梯（三菱）", qty: 4, unit: "台", warehouse: "合和新城现场仓", date: "2026-05-20", receiver: "赵铁柱", status: "已入库" },
    { id: "jd04", no: "JDH-2026-004", projectId: "p2", material: "甲供中央空调机组", qty: 8, unit: "台", warehouse: "中心仓", date: "2026-06-02", receiver: "周伟峰", status: "已入库" },
    { id: "jd05", no: "JDH-2026-005", projectId: "p5", material: "甲供幕墙玻璃", qty: 1200, unit: "㎡", warehouse: "中心仓", date: "2026-06-20", receiver: "周维", status: "待入库" },
  ];
  // 甲供材领用
  const omUses = [
    { id: "jy01", no: "JLY-2026-001", projectId: "p1", material: "甲供铝合金门窗", qty: 2600, unit: "㎡", receiver: "虞建华", useFor: "1-2 号楼门窗安装", date: "2026-05-25" },
    { id: "jy02", no: "JLY-2026-002", projectId: "p1", material: "甲供铝合金门窗", qty: 2200, unit: "㎡", receiver: "虞建华", useFor: "3 号楼门窗安装", date: "2026-06-15" },
    { id: "jy03", no: "JLY-2026-003", projectId: "p1", material: "甲供电梯（三菱）", qty: 2, unit: "台", receiver: "赵铁柱", useFor: "1 号楼电梯安装", date: "2026-06-01" },
    { id: "jy04", no: "JLY-2026-004", projectId: "p2", material: "甲供中央空调机组", qty: 6, unit: "台", receiver: "周伟峰", useFor: "南区空调安装", date: "2026-06-20" },
  ];
  // 甲供材直入直出（不入库直接用到部位）
  const omDirects = [
    { id: "jzz01", no: "ZR-2026-001", projectId: "p1", material: "甲供商砼（补量）", qty: 120, unit: "m³", party: "合和地产集团", useFor: "3 号楼直供直浇", date: "2026-04-18" },
    { id: "jzz02", no: "ZR-2026-002", projectId: "p2", material: "甲供防水涂料", qty: 40, unit: "桶", party: "锦绣置业有限公司", useFor: "南区卫生间直用", date: "2026-05-30" },
    { id: "jzz03", no: "ZR-2026-003", projectId: "p5", material: "甲供石材干挂件", qty: 800, unit: "套", party: "天河城建投资", useFor: "幕墙直装", date: "2026-06-25" },
  ];

  // ——— 批E 轻实体仓：客户（红圈09 甲方档案）+ 项目其他合同（红圈11）（稳定 id 够蓝链，金额 mock）———
  // 客户 = 项目 developer 文本的实体化（name 与 projects.developer 严格同名，供项目详情「客户(甲方)」蓝链 + 反向聚合）
  const customers = [
    { id: "cu1", name: "合和地产集团", contact: "郑建业", phone: "13902200001", address: "广州市天河区珠江新城", taxNo: "91440101MA5AA00001", note: "长期合作·总承包甲方" },
    { id: "cu2", name: "锦绣置业有限公司", contact: "李锦华", phone: "13902200002", address: "广州市番禺区市桥街道", taxNo: "91440113MA5AA00002", note: "" },
    { id: "cu3", name: "翠湖投资", contact: "黄翠湖", phone: "13902200003", address: "广州市天河区天源路", taxNo: "91440106MA5AA00003", note: "" },
    { id: "cu4", name: "江湾置业", contact: "陈江湾", phone: "13902200004", address: "广州市海珠区滨江东路", taxNo: "91440105MA5AA00004", note: "项目停工中" },
    { id: "cu5", name: "天河城建投资", contact: "周天河", phone: "13902200005", address: "广州市天河区车陂路", taxNo: "91440106MA5AA00005", note: "" },
    { id: "cu6", name: "广州开发区建设集团", contact: "郑开元", phone: "13902200006", address: "广州市黄埔区科学大道", taxNo: "91440112MA5AA00006", note: "国企甲方" },
    { id: "cu7", name: "广州亚运城开发", contact: "何亚运", phone: "13902200007", address: "广州市番禺区亚运大道", taxNo: "91440113MA5AA00007", note: "已竣工结算" },
    { id: "cu8", name: "利丰置业", contact: "刘利丰", phone: "13902200008", address: "佛山市南海区利丰北路", taxNo: "91440605MA5AA00008", note: "" },
    { id: "cu9", name: "保利番禺地产", contact: "叶保利", phone: "13902200009", address: "广州市番禺区领秀海", taxNo: "91440113MA5AA00009", note: "" },
    { id: "cu10", name: "未来印象置业", contact: "王印象", phone: "13902200010", address: "广州市增城区荔城街道", taxNo: "91440118MA5AA00010", note: "已竣工·保修中" },
    { id: "cu11", name: "白云机场建设", contact: "陈云飞", phone: "13902200011", address: "广州市花都区机场北路", taxNo: "91440114MA5AA00011", note: "" },
    { id: "cu12", name: "广州市政集团", contact: "李政通", phone: "13902200012", address: "广州市越秀区", taxNo: "91440104MA5AA00012", note: "零星维修框架甲方" },
  ];
  // 公司支出合同（红圈11 · 公司层面、不挂项目：房租/软件/其他；连费用报销）
  const companyExps = [
    { id: "qy1", no: "GS-2026-001", name: "公司办公室租赁合同", category: "房租", counterparty: "广州天河甲级写字楼", amount: 816000, signDate: "2026-01-01", period: "2026-01~2026-12", status: "履约中" },
    { id: "qy2", no: "GS-2026-002", name: "用友财务软件年费", category: "软件", counterparty: "用友网络科技", amount: 48000, signDate: "2026-01-15", period: "年费", status: "履约中" },
    { id: "qy3", no: "GS-2026-003", name: "广联达造价软件", category: "软件", counterparty: "广联达科技", amount: 36000, signDate: "2026-02-01", period: "年费", status: "履约中" },
    { id: "qy4", no: "GS-2025-004", name: "公司社保代理服务", category: "其他", counterparty: "广州人力资源服务", amount: 120000, signDate: "2025-06-01", period: "年费", status: "已结清" },
    { id: "qy5", no: "GS-2026-005", name: "项目部临时办公板房租赁", category: "房租", counterparty: "华丰活动板房", amount: 96000, signDate: "2026-03-01", period: "2026-03~2027-02", status: "履约中" },
  ];
  // 其他支出合同（红圈11 · 项目上非分包/材料的杂项支出，如机械租赁/检测服务）
  const otherExps = [
    { id: "qt1", no: "QT-2026-001", name: "合和新城塔吊租赁合同", projectId: "p1", category: "机械租赁", counterparty: "广州建机租赁", amount: 480000, signDate: "2025-10-01", status: "履约中" },
    { id: "qt2", no: "QT-2026-002", name: "锦绣华庭施工电梯租赁", projectId: "p2", category: "机械租赁", counterparty: "恒升机械", amount: 216000, signDate: "2026-02-10", status: "履约中" },
    { id: "qt3", no: "QT-2026-003", name: "车陂大楼安全监测服务", projectId: "p5", category: "检测服务", counterparty: "华测检测", amount: 68000, signDate: "2026-03-15", status: "履约中" },
    { id: "qt4", no: "QT-2026-004", name: "科学城项目临时用电增容", projectId: "p6", category: "其他", counterparty: "南方电网服务", amount: 42000, signDate: "2026-04-01", status: "已结清" },
  ];
  // 其他支出结算（其他支出合同的结算单）
  const otherSettles = [
    { id: "qs1", no: "QTJS-2026-001", name: "塔吊租赁 6 月结算", projectId: "p1", contractId: "qt1", amount: 240000, date: "2026-06-30", status: "已确认" },
    { id: "qs2", no: "QTJS-2026-002", name: "施工电梯租赁结算", projectId: "p2", contractId: "qt2", amount: 108000, date: "2026-06-28", status: "已确认" },
    { id: "qs3", no: "QTJS-2026-003", name: "安全监测服务结算", projectId: "p5", contractId: "qt3", amount: 34000, date: "2026-07-05", status: "待确认" },
  ];

  const factorDefaults = [
    { id: "f1", name: "HRB400 螺纹钢 Φ12", unit: "吨", price: 3980 },
    { id: "f2", name: "C30 商品混凝土", unit: "m³", price: 462 },
    { id: "f3", name: "镀锌钢管 DN50", unit: "根", price: 86 },
    { id: "f4", name: "防水卷材 SBS", unit: "卷", price: 320 },
  ];

  window.KIT_DATA = { invoices, suppliers, projects, workers, priceSuppliers, priceRows, deliveryFiles, crews, crewConfig, matrix, payroll, projectCrews, factorDefaults, contracts,
    payApplies, receipts, invApplies, currents, payRecords, reimburses,
    targetCosts, targetCostTrees, ownerChanges, ownerReports, acceptances, finalSettles, ownerPenalties, subChanges, subSettles, projPenalties,
    matRequisitions, matArrivals, matUses, matSettles, stockChecks, omTotals, omRequisitions, omArrivals, omUses, omDirects,
    deliveryArchives, customers, companyExps, otherExps, otherSettles };
})();
