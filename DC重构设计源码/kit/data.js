// 瑞航 CRM 设计稿 — 演示数据（贴近工地/财务场景，值全部匿名虚构，非真实企业）
// 暴露到 window 供各屏共享。真实数据覆写层为 gitignored 的 kit/data.local.js，绝不入库、绝不推送。
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
    // 手工补录行：无扫描原件（归档库「原件」列的「缺原件」态样本）
    { id: "a11", name: "", projectId: "p2", supplierId: "s4", ocrCompany: "穗建五金机电经营部", no: "S06277", date: "2026-06-27", material: "膨胀螺栓 M10 / 25 盒", amount: 600, note: "手工补录，对方未给单" },
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

// —— 2026-07-18 表单补全轮：整页表单新字段精选回填（grill 决议 #7）——
// 每个重点实体挑 1~2 行代表性假数据补齐新字段，编辑演示不见大片空白；
// 量级/写法风格对标真实数据蓝本（金额到分、粤系公司名/人名），值全部虚构。其余行留空属正常。
(function () {
  const d = window.KIT_DATA;
  if (!d) return;
  const patch = (arr, id, p) => { const r = (arr || []).find((x) => x.id === id); if (r) Object.assign(r, p); };

  // 施工合同 sg01：条款/质保/开票方/履约联系人
  patch(d.contracts, "sg01", {
    client: "cu1", content: "合和新城住宅项目室内外装饰装修总承包", isSupplement: "否", invoiceType: "增值税专用发票",
    contact: "刘志强", contactPhone: "13802734561", taxRate: "9%",
    terms: "按建设工程施工合同示范文本（GF-2017-0201）签订，专用条款优先。",
    termPay: "按月度报量审定产值的 80% 支付进度款，竣工结算后付至 97%，余 3% 作质保金。",
    termTime: "总工期 610 日历天，2026-05-01 开工，工期顺延须经监理与甲方书面确认。",
    warrantyRate: 3, warrantyAmount: 971652.68, warrantyDays: 730,
    invoiceName: "广州市瑞航建筑工程有限公司", invoiceTaxNo: "91440101MA5AJ2K87L",
    invoiceBank: "中国建设银行广州体育东路支行", invoiceAccount: "44050143260100002317",
  });
  // 分包合同 fb01：劳务条款
  patch(d.contracts, "fb01", {
    content: "泥水工程劳务分包（砌筑/抹灰/铺贴）", isSupplement: "否", invoiceType: "增值税专用发票",
    contact: "陈锦洪", contactPhone: "13711052388", taxRate: "9%",
    termPay: "按完成工程量月度计量，次月 25 日前支付 85%，结算后付清。",
    warrantyRate: 5, warrantyDays: 365,
  });
  // 材采合同 cg01：采购明细行 + 开票方（销方）
  patch(d.contracts, "cg01", {
    content: "全抛釉瓷砖及配套供货", isSupplement: "否", invoiceType: "增值税专用发票",
    contact: "黄启文", contactPhone: "13924078815", taxRate: "13%",
    termBrand: "东鹏/马可波罗一级品，色号以封样为准，每批附出厂检验报告。",
    termTime: "下单后 15 日内分批到场，急件 72 小时内补货。",
    warrantyRate: 2, warrantyDays: 365,
    invoiceName: "广州市大板东建材有限公司", invoiceTaxNo: "91440101MA9W3XB22F",
    invoiceBank: "中国工商银行广州黄石支行", invoiceAccount: "3602814409100387256",
    lines: [
      { name: "全抛釉瓷砖", spec: "800×800", brand: "东鹏", unit: "块", qty: 12600, price: 42.8, amount: 539280, planDate: "2026-06-20", note: "首批样板层" },
      { name: "阳角线", spec: "2440mm", brand: "配套", unit: "根", qty: 1800, price: 9.5, amount: 17100, planDate: "2026-06-20", note: "" },
      { name: "瓷砖胶", spec: "20kg/包", brand: "德高", unit: "包", qty: 4200, price: 33.6, amount: 141120, planDate: "2026-07-05", note: "分两批" },
    ],
  });
  // 付款申请 fk02：付款内容 + 关联结算/发票行
  patch(d.payApplies, "fk02", {
    payContent: "泥水班组 6 月砌筑抹灰进度款，对应 10-12 栋完成工程量。",
    settleLinks: [{ sNo: "FBJS-2026-006", sName: "泥水班组 6 月过程结算", sAmt: 386500, sLink: 328525, sNote: "按 85% 支付" }],
    invoiceLinks: [{ iNo: "04403276911", iDate: "2026-07-02", iAmt: 328525, iLink: 328525 }],
  });
  // 收款登记 sk01：经办/期次/流水
  patch(d.receipts, "sk01", { handler: "周维", periodLabel: "2026 年 5 月进度款", bankRef: "20260528100443172", status: "已登记", payerAccount: "8873" });
  // 开票申请 kp01：名称/购方/开票内容
  patch(d.invApplies, "kp01", { name: "合和新城 5 月进度款开票", invoiceType: "增值税专用发票", buyer: "合和地产集团", buyerTaxNo: "91440101MA5CFH991Q", content: "建筑服务*工程款" });
  // 分供方 s1（材料）/ s5（劳务）：工商/开票/评价档案
  patch(d.suppliers, "s1", {
    businessType: "公司分供方", uniqueCode: "MA9W3XB2", legalRep: "潘大板", registeredCapital: 500,
    registeredDate: "2015-03-18", address: "广州市白云区石井大道 128 号", taxpayerType: "一般纳税人", rating: "A",
    mainBusiness: "建筑陶瓷、石材、辅材批发零售", contactTitle: "销售经理",
    invoiceName: "广州市大板东建材有限公司", invoiceAddr: "广州市白云区石井大道 128 号 020-86342217",
  });
  patch(d.suppliers, "s5", {
    businessType: "公司分供方", legalRep: "陈锦洪", registeredCapital: 100, registeredDate: "2018-09-02",
    address: "佛山市南海区大沥镇联安路 33 号", taxpayerType: "小规模纳税人", rating: "B",
    mainBusiness: "建筑劳务分包（砌筑、抹灰、地面铺贴）", contactTitle: "班组负责人",
  });
  // 甲方变洽签 oc1：指令单 + 变更行
  patch(d.ownerChanges, "oc1", {
    directiveNo: "JXHT-ZL-2026-013", directiveType: "下发",
    reason: "甲方设计变更：公区墙面由乳胶漆改为仿石材铝板，含基层调整。",
    lines: [
      { name: "公区墙面仿石材铝板", unit: "㎡", qtyDiff: 860, price: 385, amount: 331100, note: "含龙骨基层" },
      { name: "原乳胶漆墙面取消", unit: "㎡", qtyDiff: -860, price: 48, amount: -41280, note: "扣减" },
    ],
  });
  // 材料到货 dh01：到货明细 + 质检
  patch(d.matArrivals, "dh01", {
    quality: "合格",
    lines: [
      { material: "全抛釉瓷砖", spec: "800×800", unit: "块", qty: 4200, price: 42.8, amount: 179760, note: "10 栋首批" },
      { material: "瓷砖胶", spec: "20kg/包", unit: "包", qty: 1400, price: 33.6, amount: 47040, note: "" },
    ],
  });
  // 库存盘点 pd01：盘点明细（盈亏聚合示范）
  patch(d.stockChecks, "pd01", {
    lines: [
      { material: "全抛釉瓷砖", spec: "800×800", unit: "块", bookQty: 2600, realQty: 2588, diffQty: -12, diffAmount: -513.6 },
      { material: "瓷砖胶", spec: "20kg/包", unit: "包", bookQty: 640, realQty: 640, diffQty: 0, diffAmount: 0 },
      { material: "阳角线", spec: "2440mm", unit: "根", bookQty: 950, realQty: 962, diffQty: 12, diffAmount: 114 },
    ],
  });
  // 工人 w1：银行/紧急联系人/技能档案
  patch(d.workers, "w1", {
    gender: "男", hometown: "广东梅州", skillLevel: "高级", dailyWage: 420,
    bankName: "中国建设银行广州天河支行", bankAccount: "6217003810051234987", bankCode: "105581000418",
    emergencyContact: "王芳", emergencyPhone: "13600418867",
  });
  // 客户 cu1：工商开票档案
  patch(d.customers, "cu1", {
    aliases: ["合和"], legalRep: "何宗盛",
    invoiceName: "合和地产集团有限公司", bank: "招商银行广州分行营业部", bankAccount: "120903618810602",
  });
  // 班组 c1：计薪参数
  patch(d.crews, "c1", { payRatio: 95, rentSubsidy: "开启", rentPrice: 3.0, mgmtFee: "开启", mgmtPrice: 1.5 });
  // 项目 p1：地域/概况/参建单位
  patch(d.projects, "p1", {
    region: "广州·白云", code: "RJ-2026-001", area: 86500, riskLevel: "低",
    overview: "22 栋高层住宅室内精装 + 公区装饰，建筑面积约 8.65 万㎡，精装交付标准。",
    managerPhone: "13802734561", supervisor: "广州建雅工程监理有限公司", designer: "华南装饰设计研究院", siteLeader: "黄伟明", siteLeaderPhone: "13710294452",
  });
})();

// —— 2026-07-20 进度款域重构（#117 grill 定稿）：请款主体（负责人簿）数据层 PAYSLIP v2 ——
// D1 单一数据链：A 族清单行从工程量管理（window.WAGE）聚合派生（同人合并、异人拆行，行名=栋+户型+分项），
//   工具面/台账面/核对表/A4 同一套数；核对表手工调整只起核对作用，不构成第二本账。
// D3/D6 生命周期三态：草稿(活算) → 已核对(留指纹，上游变动→「有变动、需重核」) → 已发放(登记实际金额→快照固化只读)；
//   「累计已领」= 往月实际发放值之和（废除运行时递归重算）；「暂不支付」= 不执行发放、应发滚存（不再取整记 0）。
// D7 单据主体 = 负责人：一本请款簿 = 负责人 + 组员多行工资表/考勤表；取整请款额组内分配（默认全给负责人，可改）；
//   「单独计价」= 该人自己当负责人开一本（公司代管无管理费，或组员离职拆簿）。
// D8/D9 格式族：A 户型派生 / B BOQ 直报（行从关联合同清单抽取，简化链、结算尾款走累计链）/
//   C1 月薪时工（加班时薪默认=日薪÷8）/ C2 零星签工（大工价×工数，半工=0.5，确认规则可编辑脚注）；
//   管理费单 = 管理人自己的进度款单（栋×分项汇总量×费率，支持负单价代付行），自动生成。
// ⑥ 空鼓：进度月只列示（从户记录聚合，WAGE.hollowAgg），「开始扣款」手动启动 → 按仍未整改处数×单处金额
//   生成扣款行（挂在本次进度请款合计之后、取整之前）；已整改销记不扣；「暂扣→返还」机制废除。
// ⑦ 支付比例：单据级参数（默认沿用上月，首月建档给），废除预排递增 schedule；月份轴含 结算95%（可改）/尾款100% 档。
// ⑤ 审批表 = 工资表（签字确认并按手印列 + 四签名栏即审批载体），A4 不加审批表页；
//   ⑤b 发放固化时在付款管理域生成支出记录（类别=工人工资，设计稿以 toast 呈现）。
(function () {
  const r2 = (n) => Math.round(n * 100) / 100;
  const floorN = (n, unit) => { const u = Math.max(1, unit || 100); return Math.max(0, Math.floor(n / u) * u); };
  const attArr = (n) => { const a = []; let c = 0; for (let i = 0; i < 31; i++) { const on = i % 7 !== 6 && c < n; if (on) c++; a.push(on ? "√" : ""); } return a; };

  // —— 名册登记表（D8-10，挂班组·工人域 #73）：性别/籍贯/身份证/劳动合同/入退场日期/证件照/银行卡照 ——
  // 进/退场日期 → 瀑布卡「在班 X 人 · 离职 Y 人」（D2）；退场且有未整改空鼓 → 提示启动扣款（⑥-3）。
  const roster = {
    "泥水A班": [
      { name: "虞建华", gender: "男", origin: "浙江绍兴", idNo: "330682198503117890", contract: "已签 2024-08-15", entry: "2024-08-15", exit: null, safety: true, photo: true, bankPhoto: true,
        bank: { holder: "虞建华", phone: "13873962451", account: "6228 4800 8125 6829 011", branch: "农业银行韶关浈江支行" } },
      { name: "王芳（虞嫂）", gender: "女", origin: "浙江绍兴", idNo: "330682198706128901", contract: "已签 2024-08-15", entry: "2024-08-15", exit: null, safety: true, photo: true, bankPhoto: true,
        bank: { holder: "王芳", phone: "13873962455", account: "6228 4800 2311 7845 023", branch: "农业银行韶关浈江支行" } },
      { name: "张建国", gender: "男", origin: "江西吉安", idNo: "362426198712146789", contract: "已签 2024-09-01", entry: "2024-09-01", exit: null, safety: true, photo: true, bankPhoto: true,
        bank: { holder: "张建国", phone: "13612078834", account: "6212 2620 1003 5417 902", branch: "工商银行广州黄埔支行" } },
      { name: "孙大勇", gender: "男", origin: "四川南充", idNo: "511325198807122345", contract: "已签 2025-01-12", entry: "2025-01-12", exit: null, safety: true, photo: true, bankPhoto: false,
        bank: { holder: "孙大勇", phone: "13560104428", account: "6212 2635 7008 1145 337", branch: "工商银行佛山南海支行" } },
      { name: "匡志强", gender: "男", origin: "湖南衡阳", idNo: "430481198905264567", contract: "已签 2024-09-10", entry: "2024-09-10", exit: null, safety: false, photo: true, bankPhoto: true,
        bank: { holder: "匡志强", phone: "13725690417", account: "6217 0028 3910 2264 780", branch: "建设银行广州车陂支行" } },
      { name: "赵铁柱", gender: "男", origin: "广东清远", idNo: "440181199003051234", contract: "已签 2025-03-20", entry: "2025-03-20", exit: "2026-06-10", safety: true, photo: true, bankPhoto: true,
        bank: { holder: "赵铁柱", phone: "13924471182", account: "6228 4811 9077 3390 552", branch: "农业银行清远清城支行" } },
    ],
    "木工一班": [
      { name: "周伟峰", gender: "男", origin: "安徽宿州", idNo: "342221199211053456", contract: "已签 2025-01-20", entry: "2025-01-20", exit: null, safety: true, photo: true, bankPhoto: true,
        bank: { holder: "周伟峰", phone: "13802276645", account: "6217 0031 2088 4419 206", branch: "建设银行广州天河支行" } },
      { name: "郑春明", gender: "男", origin: "广西玉林", idNo: "452123199001025678", contract: "已签 2025-02-01", entry: "2025-02-01", exit: null, safety: true, photo: true, bankPhoto: true,
        bank: { holder: "郑春明", phone: "13710388290", account: "6222 0210 0118 6634 951", branch: "交通银行广州东圃支行" } },
    ],
    "杂工班": [
      { name: "杨红彬", gender: "男", origin: "四川广安", idNo: "511623198209150013", contract: "已签 2026-04-18", entry: "2026-04-18", exit: null, safety: true, photo: true, bankPhoto: true,
        bank: { holder: "杨红彬", phone: "13539917790", account: "6228 4528 7807 8625 871", branch: "农业银行四川广安罗渡镇支行" } },
      { name: "蔡燕琼", gender: "女", origin: "四川广安", idNo: "511623198512220020", contract: "已签 2026-04-18", entry: "2026-04-18", exit: null, safety: true, photo: true, bankPhoto: true,
        bank: { holder: "蔡燕琼", phone: "18161160100", account: "6210 9867 3700 0050 967", branch: "邮政银行四川广安罗渡镇支行" } },
    ],
    "暖通安装班": [
      { name: "陈国强", gender: "男", origin: "湖北孝感", idNo: "420921197808124512", contract: "已签 2025-10-12", entry: "2025-10-12", exit: "2026-01-20", safety: true, photo: true, bankPhoto: true,
        bank: { holder: "陈国强", phone: "13688904471", account: "6212 2601 1198 3345 208", branch: "工商银行广州东圃支行" } },
      { name: "黄伟荣", gender: "男", origin: "广东茂名", idNo: "440923199105083317", contract: "已签 2025-10-12", entry: "2025-10-12", exit: "2026-01-20", safety: true, photo: true, bankPhoto: true,
        bank: { holder: "黄伟荣", phone: "13570221809", account: "6217 0033 4901 5568 114", branch: "建设银行广州珠村支行" } },
    ],
    "泥水时工组": [
      { name: "周维", gender: "男", origin: "湖南邵阳", idNo: "430522198010264428", contract: "未签（零星）", entry: "2025-11-20", exit: "2026-01-15", safety: true, photo: true, bankPhoto: true,
        bank: { holder: "周维", phone: "13725500981", account: "6212 2609 0233 7712 001", branch: "工商银行广州车陂支行" } },
      { name: "黄伟荣", gender: "男", origin: "广东茂名", idNo: "440923199105083317", contract: "未签（零星）", entry: "2025-11-20", exit: "2026-01-15", safety: true, photo: true, bankPhoto: true,
        bank: { holder: "黄伟荣", phone: "13570221809", account: "6217 0033 4901 5568 114", branch: "建设银行广州珠村支行" } },
    ],
  };

  // —— 请款簿（一个负责人一本；family: A 户型派生 / B BOQ直报 / C1 月薪时工 / C2 零星签工 / MGR 管理费单）——
  // 月份键：YYYY-MM 或 "结算"/"尾款"；月份数据字段：
  //   status 草稿|已核对|已发放|未到；ratio 单据级比例（⑦）；seqNo 全项目递增请款序号（D8-8）；
  //   actualPaid 实际发放金额（D6 以实际为准）；alloc 组内分配（D7）；borrow 按人借支；attN 按人出勤天数；
  //   floorsSnap/priceSnap 发放固化的当月工程量/单价快照（D3）；deduct 空鼓扣款（⑥ 手动启动后生成）；
  //   deferred 暂不支付（滚存）；checkedFp 核对指纹（"__ok__"=演示种子不比对，"__stale__"=演示已过期）。
  const FL = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const books = [
    { id: "B1", project: "合和新城", crew: "泥水A班", trade: "泥水", tradeKey: "mason", family: "A",
      leader: "虞建华", members: ["虞建华", "王芳（虞嫂）"], scopeLabel: "墙砖、地砖",
      config: { ratioFirst: 75, round: 100, contract: null,
        subsidies: [{ name: "合计工程量房租", price: 1.30, items: ["墙砖", "地砖"] }],
        hollowPrice: 30, hollowTiming: "结算时扣（可手动提前启动）",
        mgr: { mode: "班组管理", person: "虞建华", rate: 2.5 }, priceAdj: {} },
      monthSeq: ["2026-04", "2026-05", "2026-06", "结算", "尾款"],
      months: {
        "2026-04": { status: "已发放", ratio: 75, seqNo: 29, actualPaid: 24700, alloc: { "虞建华": 16400, "王芳（虞嫂）": 8300 },
          floorsSnap: { "1栋": FL(1, 8), "2栋": FL(1, 3) }, priceSnap: { "墙砖": 36, "地砖": 32 }, borrow: {}, attN: { "虞建华": 24, "王芳（虞嫂）": 22 } },
        "2026-05": { status: "已发放", ratio: 80, seqNo: 32, actualPaid: 30600, alloc: { "虞建华": 20600, "王芳（虞嫂）": 10000 },
          floorsSnap: { "1栋": [1, 2, 3, 4, 5, 6, 7, 8, 9, 11], "2栋": FL(1, 4) }, priceSnap: { "墙砖": 36, "地砖": 32 }, borrow: {}, attN: { "虞建华": 26, "王芳（虞嫂）": 24 } },
        "2026-06": { status: "草稿", ratio: 80, borrow: { "虞建华": 0, "王芳（虞嫂）": 0 }, attN: { "虞建华": 25, "王芳（虞嫂）": 23 } },
        "结算": { kind: "settle", status: "未到", ratio: 95 },
        "尾款": { kind: "final", status: "未到", ratio: 100 },
      } },
    { id: "B2", project: "合和新城", crew: "泥水A班", trade: "泥水", tradeKey: "mason", family: "A",
      leader: "张建国", members: ["张建国", "孙大勇"], scopeLabel: "墙砖、地砖",
      config: { ratioFirst: 75, round: 100, contract: null,
        subsidies: [{ name: "合计工程量房租", price: 1.30, items: ["墙砖", "地砖"] }],
        hollowPrice: 30, hollowTiming: "结算时扣（可手动提前启动）",
        mgr: { mode: "班组管理", person: "虞建华", rate: 2.5 }, priceAdj: {} },
      monthSeq: ["2026-04", "2026-05", "2026-06", "结算", "尾款"],
      months: {
        "2026-04": { status: "已发放", ratio: 75, seqNo: 30, actualPaid: 26400, alloc: { "张建国": 26400 },
          floorsSnap: { "1栋": FL(1, 8), "2栋": FL(1, 3) }, priceSnap: { "墙砖": 36, "地砖": 32 }, borrow: {}, attN: { "张建国": 25, "孙大勇": 24 } },
        "2026-05": { status: "已发放", ratio: 80, seqNo: 33, actualPaid: 31900, alloc: { "张建国": 20000, "孙大勇": 11900 },
          floorsSnap: { "1栋": [1, 2, 3, 4, 5, 6, 7, 8, 9, 11], "2栋": FL(1, 4) }, priceSnap: { "墙砖": 36, "地砖": 32 }, borrow: { "孙大勇": 500 }, attN: { "张建国": 27, "孙大勇": 26 } },
        "2026-06": { status: "已核对", ratio: 85, checkedFp: "__stale__", borrow: { "张建国": 1000 }, attN: { "张建国": 26, "孙大勇": 27 } },
        "结算": { kind: "settle", status: "未到", ratio: 95 },
        "尾款": { kind: "final", status: "未到", ratio: 100 },
      } },
    { id: "B3", project: "合和新城", crew: "泥水A班", trade: "泥水", tradeKey: "mason", family: "A",
      leader: "匡志强", members: ["匡志强"], scopeLabel: "02户墙砖（单独）",
      soloNote: "单独出单：该工序无班组管理、由我方代管（D7 成因①），故无管理费、独立一本。",
      config: { ratioFirst: 75, round: 100, contract: null,
        subsidies: [{ name: "合计工程量房租", price: 1.30, items: ["墙砖", "地砖"] }],
        hollowPrice: 30, hollowTiming: "结算时扣（可手动提前启动）",
        mgr: { mode: "公司代管" }, priceAdj: {} },
      monthSeq: ["2026-05", "2026-06", "结算", "尾款"],
      months: {
        "2026-05": { status: "已发放", ratio: 80, seqNo: 34, actualPaid: 14000, alloc: { "匡志强": 14000 },
          floorsSnap: { "1栋": [1, 2, 3, 4, 5, 6, 7, 8, 9, 11], "2栋": FL(1, 4) }, priceSnap: { "墙砖": 36, "地砖": 32 }, borrow: {}, attN: { "匡志强": 22 } },
        "2026-06": { status: "草稿", ratio: 80, borrow: { "匡志强": 800 }, attN: { "匡志强": 23 } },
        "结算": { kind: "settle", status: "未到", ratio: 95 },
        "尾款": { kind: "final", status: "未到", ratio: 100 },
      } },
    { id: "B4", project: "合和新城", crew: "泥水A班", trade: "泥水", tradeKey: "mason", family: "A",
      leader: "赵铁柱", members: ["赵铁柱"], scopeLabel: "03户地砖",
      config: { ratioFirst: 75, round: 100, contract: null,
        subsidies: [{ name: "合计工程量房租", price: 1.30, items: ["墙砖", "地砖"] }],
        hollowPrice: 30, hollowTiming: "结算时扣（离职必扣，可手动启动）",
        mgr: { mode: "班组管理", person: "虞建华", rate: 2.5 }, priceAdj: {} },
      monthSeq: ["2026-04", "2026-05", "2026-06", "结算", "尾款"],
      months: {
        "2026-04": { status: "已发放", ratio: 75, seqNo: 28, actualPaid: 12000, alloc: { "赵铁柱": 12000 },
          floorsSnap: { "1栋": FL(1, 8), "2栋": FL(1, 3) }, priceSnap: { "墙砖": 36, "地砖": 32 }, borrow: {}, attN: { "赵铁柱": 23 } },
        "2026-05": { status: "已核对", ratio: 80, checkedFp: "__ok__", deferred: true, borrow: {}, attN: { "赵铁柱": 25 } },
        "2026-06": { status: "草稿", ratio: 80, borrow: {}, attN: { "赵铁柱": 6 } },
        "结算": { kind: "settle", status: "未到", ratio: 95 },
        "尾款": { kind: "final", status: "未到", ratio: 100 },
      } },
    { id: "B5", project: "合和新城", crew: "泥水A班", trade: "泥水", tradeKey: "mason", family: "MGR", auto: true,
      leader: "虞建华", members: ["虞建华"], scopeLabel: "管理费",
      autoNote: "管理费单自动生成（D8-4）：行 = 栋×分项汇总量 × 2.5 元；支持负单价代付行。",
      config: { ratioFirst: 75, round: 100, contract: null, subsidies: [], priceAdj: {},
        extraRows: [{ item: "1栋淋浴板未收尾代付（负价代扣）", unit: "套", qty: 30, price: -20 }] },
      monthSeq: ["2026-04", "2026-05", "2026-06", "结算", "尾款"],
      months: {
        "2026-04": { status: "已发放", ratio: 75, seqNo: 31, actualPaid: 4600, alloc: { "虞建华": 4600 },
          floorsSnap: { "1栋": FL(1, 8), "2栋": FL(1, 3) }, priceSnap: { "管理费": 2.5 }, borrow: {}, attN: { "虞建华": 24 } },
        "2026-05": { status: "已发放", ratio: 80, seqNo: 35, actualPaid: 1800, alloc: { "虞建华": 1800 },
          floorsSnap: { "1栋": [1, 2, 3, 4, 5, 6, 7, 8, 9, 11], "2栋": FL(1, 4) }, priceSnap: { "管理费": 2.5 }, borrow: {}, attN: { "虞建华": 26 } },
        "2026-06": { status: "草稿", ratio: 80, borrow: {}, attN: { "虞建华": 25 } },
        "结算": { kind: "settle", status: "未到", ratio: 95 },
        "尾款": { kind: "final", status: "未到", ratio: 100 },
      } },
    { id: "B6", project: "合和新城", crew: "木工一班", trade: "木工", tradeKey: "carp", family: "A",
      leader: "周伟峰", members: ["周伟峰", "郑春明"], workAs: ["木工一班"], scopeLabel: "吊顶",
      config: { ratioFirst: 85, round: 100, contract: null, subsidies: [], hollowPrice: 0,
        mgr: { mode: "公司代管" }, priceAdj: {} },
      monthSeq: ["2026-05", "2026-06", "结算", "尾款"],
      months: {
        "2026-05": { status: "已发放", ratio: 85, seqNo: 36, actualPaid: 22000, alloc: { "周伟峰": 12000, "郑春明": 10000 },
          floorsSnap: { "1栋": [1, 2, 3, 4, 5, 6, 7, 8, 9, 11], "2栋": FL(1, 4) }, priceSnap: { "吊顶": 45 }, borrow: { "郑春明": 600 }, attN: { "周伟峰": 25, "郑春明": 23 } },
        "2026-06": { status: "草稿", ratio: 85, borrow: {}, attN: { "周伟峰": 26, "郑春明": 25 } },
        "结算": { kind: "settle", status: "未到", ratio: 95 },
        "尾款": { kind: "final", status: "未到", ratio: 100 },
      } },
    { id: "B7", project: "合和新城", crew: "杂工班", trade: "杂工", family: "C1",
      leader: "杨红彬", members: ["杨红彬", "蔡燕琼"], scopeLabel: "杂工",
      config: { contract: null, daily: { "杨红彬": 400, "蔡燕琼": 300 }, otRate: {} },   // 加班时薪默认=日薪÷8（400→50 实证），可按人另设
      monthSeq: ["2026-05", "2026-06"],
      months: {
        "2026-05": { status: "已发放", actualPaid: 16800, days: { "杨红彬": 24, "蔡燕琼": 24 }, otHours: {}, borrow: {}, attN: { "杨红彬": 24, "蔡燕琼": 24 } },
        "2026-06": { status: "草稿", days: { "杨红彬": 23, "蔡燕琼": 23 }, otHours: { "杨红彬": 4, "蔡燕琼": 4 }, borrow: { "蔡燕琼": 300 }, attN: { "杨红彬": 23, "蔡燕琼": 23 } },
      } },
    { id: "B8", project: "未来印象小区", crew: "暖通安装班", trade: "暖通", family: "B",
      leader: "陈国强", members: ["陈国强", "黄伟荣"], scopeLabel: "暖通安装",
      config: { ratioFirst: 80, round: 100, contract: "FB-2025-012 暖通劳务分包合同", subsidies: [], priceAdj: {}, allowManual: true },
      // ④-② B 族清单行来源=与工人签订的合同清单：分组小标题随合同带入、单价锁定（改价走 D4 调价弹窗）、
      // 长项目特征折叠显示/A4 展开、一口价「项」行只填总价。
      contractLines: [
        { group: "拆除部分" },
        { name: "风机盘管拆除", feature: "拆除原有风机盘管及冷凝水管、保温棉，含制冷剂回收、管口封堵、成品保护及建筑垃圾清运至指定地点", unit: "台", price: 85 },
        { name: "镀锌风管拆除", feature: "原镀锌风管及角钢支架整体拆除，含高空作业防护、材料分类下运、场内转驳", unit: "㎡", price: 22 },
        { group: "安装部分" },
        { name: "风机盘管安装", feature: "卧式暗装风机盘管吊装就位、减震吊架制作安装、软接与冷凝水管坡度调校，配合土建预留洞修补", unit: "台", price: 260 },
        { name: "镀锌风管制作安装", feature: "共板法兰风管制作安装，含法兰、垫料、支吊架制作安装及漏光试验配合", unit: "㎡", price: 48 },
        { name: "部分铺贴（管井周边地面修复）", feature: "管井封堵后周边地面水泥砂浆找平修复，与原地面顺平", unit: "㎡", price: 28 },
        { name: "通风系统调试", feature: "系统风量平衡调试、单机试运转及运行记录，含调试报告编制", unit: "项", price: 8000, lump: true },
      ],
      monthSeq: ["2025-11", "2025-12", "结算", "尾款"],
      months: {
        "2025-11": { status: "已发放", ratio: 80, seqNo: 11, actualPaid: 20800, alloc: { "陈国强": 13000, "黄伟荣": 7800 },
          qtys: [null, 46, 380, null, 20, 180, 0, 0], borrow: {}, attN: { "陈国强": 26, "黄伟荣": 25 } },
        "2025-12": { status: "已发放", ratio: 80, seqNo: 12, actualPaid: 21600, alloc: { "陈国强": 13600, "黄伟荣": 8000 },
          qtys: [null, 0, 0, null, 26, 240, 26, 1], borrow: {}, attN: { "陈国强": 27, "黄伟荣": 26 } },
        "结算": { kind: "settle", status: "已发放", ratio: 95, seqNo: 15, actualPaid: 8000, alloc: { "陈国强": 8000 },
          qtys: [null, 46, 380, null, 46, 420, 26, 1], borrow: {}, attN: { "陈国强": 12, "黄伟荣": 10 } },
        "尾款": { kind: "final", status: "已发放", ratio: 100, seqNo: 18, actualPaid: 2700, alloc: { "陈国强": 2700 },
          qtys: [null, 46, 380, null, 46, 420, 26, 1], borrow: {}, attN: { "陈国强": 0, "黄伟荣": 0 } },
      } },
    { id: "B9", project: "未来印象小区", crew: "泥水时工组", trade: "泥水(时工)", family: "C2",
      leader: "周维", members: ["周维", "黄伟荣"], scopeLabel: "零星用工",
      config: { contract: null, bigPrice: 350,
        footNote: "1、当日用工由证明人 2 天内确认，逾期未确认视为无效；2、虚报用工经查实按双倍扣回；3、半工按 0.5 工计。" },
      monthSeq: ["2025-12"],
      months: {
        "2025-12": { status: "已发放", seqNo: 14, actualPaid: 4725, alloc: { "周维": 2975, "黄伟荣": 1750 }, borrow: {}, attN: { "周维": 9, "黄伟荣": 5 },
          logs: [
            { d: "12-02", content: "地下室积水清理、材料转运", span: "8:00–18:00", who: "周维", units: 1, witness: "王工", confirm: "12-03" },
            { d: "12-03", content: "地下室积水清理（续）", span: "8:00–18:00", who: "周维", units: 1, witness: "王工", confirm: "12-04" },
            { d: "12-05", content: "外墙脚手架拆除配合", span: "8:00–12:00", who: "周维", units: 0.5, witness: "王工", confirm: "12-06" },
            { d: "12-05", content: "外墙脚手架拆除配合", span: "8:00–18:00", who: "黄伟荣", units: 1, witness: "王工", confirm: "12-06" },
            { d: "12-08", content: "样板间成品保护拆除、清运", span: "8:00–18:00", who: "周维", units: 1, witness: "郑工", confirm: "12-09" },
            { d: "12-08", content: "样板间成品保护拆除、清运", span: "8:00–18:00", who: "黄伟荣", units: 1, witness: "郑工", confirm: "12-09" },
            { d: "12-11", content: "地库排水沟修补", span: "8:00–18:00", who: "周维", units: 1, witness: "王工", confirm: "12-12" },
            { d: "12-15", content: "首层大堂地面保护、搬运", span: "8:00–18:00", who: "周维", units: 1, witness: "王工", confirm: "12-16" },
            { d: "12-18", content: "屋面杂物清理", span: "8:00–18:00", who: "周维", units: 1, witness: "郑工", confirm: "12-19" },
            { d: "12-18", content: "屋面杂物清理", span: "8:00–18:00", who: "黄伟荣", units: 1, witness: "郑工", confirm: "12-19" },
            { d: "12-22", content: "临边防护整改", span: "8:00–18:00", who: "周维", units: 1, witness: "王工", confirm: "12-23" },
            { d: "12-26", content: "竣工清洁配合", span: "8:00–18:00", who: "周维", units: 1, witness: "王工", confirm: "12-27" },
            { d: "12-26", content: "竣工清洁配合", span: "8:00–18:00", who: "黄伟荣", units: 1, witness: "王工", confirm: "12-27" },
            { d: "12-28", content: "移交前场地清理", span: "8:00–12:00", who: "黄伟荣", units: 1, witness: "郑工", confirm: "12-29" },
          ] },
      } },
  ];

  // —— 工具 ——
  const bookById = (id) => books.find((b) => b.id === id) || null;
  const booksOf = (project, crew) => books.filter((b) => b.project === project && (!crew || b.crew === crew));
  const rosterOf = (crew) => {
    const list = roster[crew] || [];
    return { list, active: list.filter((r) => !r.exit).length, exited: list.filter((r) => r.exit).length };
  };
  const bankOf = (name) => {
    for (const k in roster) { const hit = roster[k].find((r) => r.name === name); if (hit) return hit.bank; }
    return null;
  };
  const rosterRow = (name) => {
    for (const k in roster) { const hit = roster[k].find((r) => r.name === name); if (hit) return hit; }
    return null;
  };
  const monthLabel = (mKey, mo) => {
    if (mo && mo.kind === "settle") return "结算 " + (mo.ratio != null ? mo.ratio : 95) + "%";
    if (mo && mo.kind === "final") return "尾款 100%";
    return mKey;
  };
  const nextSeq = (project) => {
    let mx = 0;
    books.filter((b) => b.project === project).forEach((b) => Object.keys(b.months).forEach((k) => {
      const s = b.months[k].seqNo; if (s && s > mx) mx = s;
    }));
    return mx + 1;
  };
  const docName = (book, mKey) => {
    const mo = book.months[mKey] || {};
    const tail = "（" + book.leader + "）";
    if (mo.kind === "settle") return book.project + "-" + book.scopeLabel + "结算款95%" + tail;
    if (mo.kind === "final") return book.project + "-" + book.scopeLabel + "尾款结清100%" + tail;
    const p = mKey.split("-");
    const base = book.project + "-" + book.scopeLabel + p[0] + "年" + parseInt(p[1]) + "月";
    return base + (book.family === "MGR" ? "管理费单" : book.family === "C1" ? "工资表" : book.family === "C2" ? "零星用工表" : "进度款") + tail;
  };
  const curMonth = (book) => {
    const seq = book.monthSeq;
    for (const k of seq) { const st = book.months[k].status; if (st === "草稿" || st === "已核对") return k; }
    for (let i = seq.length - 1; i >= 0; i--) if (book.months[seq[i]].status === "已发放") return seq[i];
    return seq[0];
  };

  // —— 行派生 ——
  const priceOf = (book, mo, baseItem, livePrice) => {
    if (mo.priceSnap && mo.priceSnap[baseItem] != null) return mo.priceSnap[baseItem];
    if (book.config.priceAdj && book.config.priceAdj[baseItem] != null) return book.config.priceAdj[baseItem];
    return livePrice;
  };
  // A 族：行从工程量管理聚合派生（D1）；历史月用 floorsSnap（D3 快照）
  const linesA = (book, mo) => {
    const W = window.WAGE; if (!W) return null;
    const names = book.workAs || book.members;
    return W.subjectRows(book.tradeKey, names, mo.floorsSnap || null).map((r) => {
      const price = priceOf(book, mo, r.item, r.price);
      return { b: r.b, item: r.b + r.unit + r.item, baseItem: r.item, unit: r.unitM, perUnit: r.perUnitQty,
        floors: r.floors, floorNote: r.floorNote, rooms: r.roomNote, who: r.who, qty: r.qty,
        price, amount: r2(r.qty * price),
        adj: !(mo.priceSnap && mo.priceSnap[r.item] != null) && book.config.priceAdj && book.config.priceAdj[r.item] != null };
    });
  };
  // 管理费单：栋 × 分项汇总量 × 费率（排除管理人自己与免管理费名单）+ 负价代付行（D8-4）
  const linesMgr = (book, mo) => {
    const W = window.WAGE; if (!W) return null;
    const cfg = W.config;
    const rate = priceOf(book, mo, "管理费", cfg.managerRate || 2.5);
    const lines = [];
    W.BUILDINGS.forEach((b) => {
      const doneList = mo.floorsSnap ? (mo.floorsSnap[b] || []) : W.doneFloors(b);
      const doneN = doneList.length;
      // 单次扫描按分项分桶（payrollRows 一栋只跑一遍）
      // 排除口径：管理人自己 + 免管理费名单 + 「公司代管」单独簿的全部成员（D7 成因①：代管无管理费）
      const excluded = new Set([book.leader].concat(cfg.managerExcluded || []));
      books.filter((x) => x.project === book.project && x.crew === book.crew && x.config.mgr && x.config.mgr.mode === "公司代管")
        .forEach((x) => x.members.forEach((m) => excluded.add(m)));
      const qtyByItem = {};
      W.payrollRows(book.tradeKey, b).forEach((r) => {
        if (r.item !== "墙砖" && r.item !== "地砖") return;
        if (excluded.has(r.who)) return;
        qtyByItem[r.item] = (qtyByItem[r.item] || 0) + r.perUnitQty * doneN;
      });
      ["墙砖", "地砖"].forEach((base) => {
        const qty = r2(qtyByItem[base] || 0);
        if (!qty) return;
        lines.push({ item: b + base + "汇总", baseItem: "管理费", unit: W.UNIT_M[base] || "㎡", perUnit: null,
          floors: doneN, floorNote: W.compressFloors(doneList), qty, price: rate, amount: r2(qty * rate) });
      });
    });
    (book.config.extraRows || []).forEach((x) => lines.push({ item: x.item, baseItem: null, unit: x.unit,
      perUnit: null, floors: null, floorNote: "", qty: x.qty, price: x.price, amount: r2(x.qty * x.price), extra: true }));
    return lines;
  };
  // B 族：行从关联合同清单抽取（④-②，单价锁定），group 行透传为小标题（D8-5）；lump=一口价「项」行
  const linesB = (book, mo) => {
    const out = [];
    (book.contractLines || []).forEach((l, i) => {
      if (l.group) { out.push({ group: l.group }); return; }
      const qty = (mo.qtys && mo.qtys[i] != null) ? mo.qtys[i] : 0;
      const price = l.lump ? l.price : priceOf(book, mo, l.name, l.price);
      out.push({ item: l.name, baseItem: l.name, feature: l.feature, unit: l.unit, qty,
        price, lump: !!l.lump, amount: r2(qty * price), locked: true, idx: i });
    });
    (mo.extraLines || []).forEach((x) => out.push({ item: x.name, unit: x.unit, qty: x.qty, price: x.price,
      amount: r2(x.qty * x.price), manual: true }));
    return out;
  };

  // —— 单据派生（唯一勾稽口径）——
  const calc = (bookId, mKey) => {
    const book = bookById(bookId); if (!book) return null;
    const mo = book.months[mKey]; if (!mo) return null;
    if (mo._sealed) return mo._sealed;

    const doc = { book, mKey, mo, status: mo.status, kind: mo.kind || "month", ratio: mo.ratio,
      seqNo: mo.seqNo || null, name: docName(book, mKey), deferred: !!mo.deferred,
      label: monthLabel(mKey, mo) };

    if (book.family === "C1") {
      doc.rows = book.members.map((name) => {
        const daily = (book.config.daily || {})[name] || 0;
        const days = (mo.days || {})[name] || 0;
        const otRate = (book.config.otRate && book.config.otRate[name] != null) ? book.config.otRate[name] : r2(daily / 8);
        const otHours = (mo.otHours || {})[name] || 0;
        const otAmt = r2(otHours * otRate);
        const borrow = (mo.borrow || {})[name] || 0;
        const gross = r2(daily * days);
        return { name, daily, days, otRate, otHours, otAmt, borrow, gross, net: r2(gross + otAmt - borrow),
          attN: (mo.attN || {})[name] != null ? mo.attN[name] : days, bank: bankOf(name) };
      });
      doc.total = r2(doc.rows.reduce((s, x) => s + x.net, 0));
      doc.actualPaid = mo.actualPaid != null ? mo.actualPaid : null;
      doc.fp = JSON.stringify(doc.rows.map((x) => [x.daily, x.days, x.otHours, x.borrow]));
    } else if (book.family === "C2") {
      doc.logs = mo.logs || [];
      doc.rows = book.members.map((name) => {
        const units = r2(doc.logs.filter((l) => l.who === name).reduce((s, l) => s + l.units, 0));
        const borrow = (mo.borrow || {})[name] || 0;
        return { name, units, price: book.config.bigPrice, amount: r2(units * book.config.bigPrice), borrow,
          net: r2(units * book.config.bigPrice - borrow), attN: (mo.attN || {})[name] || 0, bank: bankOf(name) };
      });
      doc.total = r2(doc.rows.reduce((s, x) => s + x.net, 0));
      doc.footNote = mo.footNote || book.config.footNote || "";
      doc.actualPaid = mo.actualPaid != null ? mo.actualPaid : null;
      doc.fp = JSON.stringify(doc.logs.map((l) => [l.d, l.who, l.units]));
    } else {
      // A / MGR / B：清单 + 请款链（D8-1 行序：合计 → ×比例 → −逐月已领(每月单列) → 本次进度请款合计 → 空鼓扣款行 → 取整）
      // 已发放且有行级快照（运行期 release 落盘）→ 直接用冻结行；否则由 floorsSnap/priceSnap 派生（种子历史月）
      doc.lines = mo.linesSnap || (book.family === "MGR" ? linesMgr(book, mo) : book.family === "B" ? linesB(book, mo) : linesA(book, mo));
      if (!doc.lines) return null;   // WAGE 未就绪
      const dataLines = doc.lines.filter((l) => !l.group);
      doc.subsidies = mo.subsSnap || (book.config.subsidies || []).map((s) => {
        const qty = r2(dataLines.filter((l) => s.items.indexOf(l.baseItem) >= 0).reduce((x, l) => x + l.qty, 0));
        return { name: s.name, qty, price: s.price, amount: r2(qty * s.price) };
      });
      doc.linesAmt = r2(dataLines.reduce((s, l) => s + l.amount, 0));
      doc.subsidyAmt = r2(doc.subsidies.reduce((s, x) => s + x.amount, 0));
      doc.total = r2(doc.linesAmt + doc.subsidyAmt);
      // 比例可为 0（单据级参数），不能用 || 兜底——0% 就是 0%
      doc.payable = r2(doc.total * (mo.ratio != null ? mo.ratio : 100) / 100);
      // 逐月已领：往月「实际发放值」之和（D6），每月单列行（D8-1）；B 族进度月为增量直报（简化链），结算/尾款走累计链
      const useCum = book.family !== "B" || mo.kind === "settle" || mo.kind === "final";
      doc.prevPaid = [];
      if (useCum) {
        for (const k of book.monthSeq) {
          if (k === mKey) break;
          const pm = book.months[k];
          if (pm.status === "已发放" && pm.actualPaid != null) {
            const lb = pm.kind === "settle" ? "结算款已申领" : pm.kind === "final" ? "尾款已申领"
              : (() => { const p = k.split("-"); return p[0] + "年" + parseInt(p[1]) + "月份已申领进度款"; })();
            doc.prevPaid.push({ key: k, label: lb, amount: pm.actualPaid });
          }
        }
      }
      doc.paidSum = r2(doc.prevPaid.reduce((s, x) => s + x.amount, 0));
      doc.request = r2(doc.payable - doc.paidSum);
      // 空鼓（⑥）：A 族泥水簿列示（从户记录聚合，进度月不扣）；deduct 启动后生成扣款行（请款合计后、取整前）
      doc.hollow = (book.family === "A" && book.tradeKey === "mason" && window.WAGE)
        ? window.WAGE.hollowAgg(book.members) : null;
      doc.deduct = mo.deduct ? { spots: mo.deduct.spots, price: mo.deduct.price,
        amount: r2(-(mo.deduct.spots * mo.deduct.price)), at: mo.deduct.at } : null;
      doc.rounded = floorN(doc.request + (doc.deduct ? doc.deduct.amount : 0), book.config.round);
      doc.actualPaid = mo.actualPaid != null ? mo.actualPaid : null;
      doc.alloc = mo.alloc || (doc.rounded > 0 ? { [book.leader]: doc.rounded } : {});
      doc.fp = JSON.stringify([dataLines.map((l) => [l.item, l.qty, l.price]), doc.subsidyAmt, mo.ratio]);
    }
    // 工资表/考勤表行（D7 负责人+组员多行）：
    // C1/C2 应发=毛额（日薪×出勤+加班 / 工数×大工价）、实发=毛额−借支（取自 rows.net，避免双扣）；
    // 计件族 应发=组内分配额、实发=分配−借支。
    doc.wageRows = book.members.map((name) => {
      const timeRow = (book.family === "C1" || book.family === "C2") ? (doc.rows.find((r) => r.name === name) || null) : null;
      const amount = timeRow
        ? (timeRow.gross != null ? r2(timeRow.gross + (timeRow.otAmt || 0)) : (timeRow.amount || 0))
        : (doc.alloc || {})[name] || 0;
      const borrow = (mo.borrow || {})[name] || 0;
      const r = rosterRow(name);
      return { name, amount, borrow, net: timeRow ? (timeRow.net || 0) : r2(amount - borrow),
        attN: (mo.attN || {})[name] || 0, bank: r ? r.bank : null, safety: r ? r.safety : true,
        att: attArr((mo.attN || {})[name] || 0) };
    });
    doc.wageTotal = r2(doc.wageRows.reduce((s, x) => s + x.net, 0));
    // 已核对指纹比对（D6-2：核对后上游数据变动 → 有变动、需重核）
    doc.dirty = mo.status === "已核对" && mo.checkedFp != null && mo.checkedFp !== "__ok__" && mo.checkedFp !== doc.fp;
    if (mo.status === "已发放") mo._sealed = doc;   // 快照固化（只读，运行期冻结）
    return doc;
  };

  // —— 班组月度汇总（L0 项目卡 / L1 瀑布卡）——
  const crewSummary = (project, crew, mKey) => {
    const bs = booksOf(project, crew);
    if (!bs.length) return null;
    const rows = bs.map((b) => {
      const m = mKey && b.months[mKey] ? mKey : curMonth(b);
      return { book: b, m, doc: calc(b.id, m) };
    }).filter((x) => x.doc);
    if (!rows.length) return null;
    const timeLike = rows.every((x) => x.book.family === "C1" || x.book.family === "C2");
    const sum = (f) => r2(rows.reduce((s, x) => s + (f(x.doc) || 0), 0));
    const ro = rosterOf(crew);
    // due = 本期应发（仅未发放单据；已发放月是历史快照，不再是「待付」）
    if (timeLike) return { timeLike: true, rows, total: sum((d) => d.total), roster: ro,
      due: sum((d) => (d.status === "已发放" ? 0 : d.total)) };
    return { timeLike: false, rows, roster: ro,
      total: sum((d) => d.total), payable: sum((d) => d.payable), paid: sum((d) => d.paidSum),
      request: sum((d) => d.request), rounded: sum((d) => d.rounded),
      due: sum((d) => (d.status === "已发放" ? 0 : d.rounded)),
      statusCount: rows.reduce((acc, x) => { acc[x.doc.status] = (acc[x.doc.status] || 0) + 1; return acc; }, {}) };
  };

  const notify = () => { if (window.APP && window.APP.notify) window.APP.notify(); };

  window.PAYSLIP = {
    books, roster, bookById, booksOf, rosterOf, bankOf, rosterRow,
    calc, curMonth, crewSummary, docName, nextSeq, monthLabel,
    update: (id, fn) => { const b = bookById(id); if (!b) return false; fn(b); notify(); return true; },
    setRatio: (id, mKey, v) => { const b = bookById(id); if (!b) return; b.months[mKey].ratio = Math.max(0, Math.min(100, +v || 0)); notify(); },
    setBorrow: (id, mKey, name, v) => { const b = bookById(id); if (!b) return; const mo = b.months[mKey]; mo.borrow = mo.borrow || {}; mo.borrow[name] = +v || 0; notify(); },
    setAlloc: (id, mKey, alloc) => { const b = bookById(id); if (!b) return; b.months[mKey].alloc = alloc; notify(); },
    // 核对（D6-2）：留当前指纹；上游再变动 → dirty
    check: (id, mKey) => { const b = bookById(id); if (!b) return; const d = calc(id, mKey); b.months[mKey].status = "已核对"; b.months[mKey].checkedFp = d ? d.fp : null; notify(); },
    backToDraft: (id, mKey) => { const b = bookById(id); if (!b) return; const mo = b.months[mKey]; if (mo.status === "已核对") { mo.status = "草稿"; delete mo.checkedFp; notify(); } },
    // 暂不支付（D6）：不执行发放动作，应发滚存到后月（不再取整记 0）
    defer: (id, mKey, on) => { const b = bookById(id); if (!b) return; b.months[mKey].deferred = !!on; notify(); },
    // 发放登记（D6-3）：登记实际最终发放金额（默认=取整应发，可改，以实际为准）→ 整体快照固化只读；
    // ⑤b：同时在付款管理域生成支出记录（设计稿以 toast 呈现，由屏幕层触发）。
    release: (id, mKey, actual, alloc) => {
      const b = bookById(id); if (!b) return null;
      const mo = b.months[mKey];
      const d = calc(id, mKey);
      mo.status = "已发放";
      // 实际发放金额以实际为准——0 也是合法登记值，不能用 || 兜回默认
      const av = actual == null || actual === "" ? NaN : +actual;
      mo.actualPaid = Number.isFinite(av) ? av : (d ? (d.rounded != null ? d.rounded : d.total) : 0);
      if (alloc) mo.alloc = alloc; else if (!mo.alloc) mo.alloc = { [b.leader]: mo.actualPaid };
      if (!mo.seqNo && b.family !== "C1") mo.seqNo = nextSeq(b.project);
      // D3 快照固化：冻结当月工程量/单价 + 完整清单行（防后续改指派/改量穿透历史月）
      if ((b.family === "A" || b.family === "MGR") && window.WAGE && !mo.floorsSnap) {
        const W = window.WAGE;
        mo.floorsSnap = {}; W.BUILDINGS.forEach((bb) => { mo.floorsSnap[bb] = (W.doneFloors(bb) || []).slice(); });
        mo.priceSnap = {};
        if (b.family === "MGR") { mo.priceSnap["管理费"] = (b.config.priceAdj || {})["管理费"] != null ? b.config.priceAdj["管理费"] : (W.config.managerRate || 2.5); }
        else { (W.TRADES[b.tradeKey].items || []).forEach((it) => { mo.priceSnap[it] = (b.config.priceAdj || {})[it] != null ? b.config.priceAdj[it] : W.price(it); }); }
      }
      if (d && d.lines) { mo.linesSnap = d.lines.map((l) => ({ ...l })); mo.subsSnap = (d.subsidies || []).map((s) => ({ ...s })); }
      delete mo._sealed;
      notify();
      return mo;
    },
    // ⑥ 空鼓扣款手动启动：按当时仍未整改处数 × 单处金额生成扣款行
    startDeduct: (id, mKey) => {
      const b = bookById(id); if (!b || !window.WAGE) return null;
      const agg = window.WAGE.hollowAgg(b.members);
      b.months[mKey].deduct = { spots: agg.unfixed, price: b.config.hollowPrice || 30, at: "手动启动" };
      notify();
      return b.months[mKey].deduct;
    },
    cancelDeduct: (id, mKey) => { const b = bookById(id); if (!b) return; delete b.months[mKey].deduct; notify(); },
    // D4 单价修改路径（弹窗双模式）：统一改=改分项基准单价（所有做该项的人、当月起）；单独改=本簿单列调价
    priceUniform: (baseItem, v) => { if (window.WAGE) window.WAGE.setPrice(baseItem, +v || 0); notify(); },
    priceSolo: (id, baseItem, v) => { const b = bookById(id); if (!b) return; b.config.priceAdj = b.config.priceAdj || {}; if (v == null || v === "") delete b.config.priceAdj[baseItem]; else b.config.priceAdj[baseItem] = +v || 0; notify(); },
    // ④ 建档：新建请款主体（格式族挂建档级）→ 生成首月草稿（计件族月份轴自动补 结算95%/尾款100% 档）
    createBook: (o) => {
      const nid = "B" + (books.reduce((mx, b) => Math.max(mx, +(String(b.id).replace(/^B/, "")) || 0), 0) + 1);
      const isTime = o.family === "C1" || o.family === "C2";
      const fm = o.firstMonth || "2026-06";
      const book = {
        id: nid, project: o.project, crew: o.crew, trade: o.trade || o.crew, tradeKey: o.tradeKey,
        family: o.family, leader: o.leader, members: o.members && o.members.length ? o.members : [o.leader],
        scopeLabel: o.scopeLabel || o.trade || o.crew,
        config: o.config || {},
        monthSeq: isTime ? [fm] : [fm, "结算", "尾款"],
        months: { [fm]: Object.assign({ status: "草稿", borrow: {}, attN: {} },
          isTime ? {} : { ratio: (o.config && o.config.ratioFirst) != null ? o.config.ratioFirst : 75 },
          o.family === "C1" ? { days: {}, otHours: {} } : {},
          o.family === "C2" ? { logs: [] } : {}) },
      };
      if (!isTime) {
        book.months["结算"] = { kind: "settle", status: "未到", ratio: 95 };
        book.months["尾款"] = { kind: "final", status: "未到", ratio: 100 };
      }
      if (o.family === "B") book.contractLines = o.contractLines || [];
      books.push(book);
      // 班组不在 projectCrews 时补挂（瀑布卡可见）
      const dd = window.KIT_DATA;
      if (dd && dd.projectCrews) {
        dd.projectCrews[o.project] = dd.projectCrews[o.project] || [];
        if (!dd.projectCrews[o.project].some((c) => c.crew === o.crew)) {
          dd.projectCrews[o.project].push({ crew: o.crew, trade: o.trade || o.crew, workers: book.members.length, net: 0, hasData: true });
        }
      }
      notify();
      return book;
    },
  };

  // —— projectCrews 增补：合和新城挂杂工班/木工有数据；未来印象小区挂 B/C2 两组（按月一册归档演示）——
  const d = window.KIT_DATA;
  if (d && d.projectCrews) {
    if (d.projectCrews["合和新城"]) {
      const hh = d.projectCrews["合和新城"];
      const mu = hh.find((c) => c.crew === "木工一班");
      if (mu) { mu.hasData = true; mu.net = 0; }
      if (!hh.some((c) => c.crew === "杂工班")) hh.splice(2, 0, { crew: "杂工班", trade: "杂工(时工)", workers: 2, net: 0, hasData: true });
    }
    if (!d.projectCrews["未来印象小区"]) {
      d.projectCrews["未来印象小区"] = [
        { crew: "暖通安装班", trade: "暖通(BOQ直报)", workers: 2, net: 0, hasData: true },
        { crew: "泥水时工组", trade: "泥水(零星签工)", workers: 2, net: 0, hasData: true },
      ];
    }
  }
  // 指派粒度（户详情复选树用）：个人=可下钻到成员逐人勾选；班组=只能整组指派。泥水按个人分发（grill 定稿）。
  ((d && d.crews) || []).forEach((c) => { if (c.assignLevel == null) c.assignLevel = /泥水/.test(c.trade || c.name) ? "个人" : "班组"; });
})();

// #244 设计稿回填：排程与工程量配置域三仓的代表性演示数据。
// 每仓 1~2 行，量级与写法风格贴近真实业务，值全部匿名虚构（ADR 0014 §9）。
(function () {
  const d = window.KIT_DATA;
  if (!d) return;

  d.processLibraries = d.processLibraries || [
    { id: "pl1", code: "STD-HOME", name: "户内装修标准工序库", version: 2, scope: "户内装修",
      status: "已发布", usedByGroups: 3, updatedAt: "2026-06-18",
      tasks: ["放线", "给排水", "电气配管", "墙砖粘贴", "地砖铺贴", "一遍腻子", "二遍腻子", "乳胶漆", "木门安装", "洁具安装", "开荒保洁"],
      note: "第 2 版把「电气配管」从墙砖之后前移到给排水之后（现场返工反馈）。" },
    { id: "pl2", code: "STD-PUB", name: "公区装修标准工序库", version: 1, scope: "公区装修",
      status: "草稿", usedByGroups: 0, updatedAt: "2026-06-26",
      tasks: ["放线", "墙面基层", "石材干挂", "吊顶龙骨", "吊顶封板", "灯具安装"], note: "" },
  ];

  d.quantityRegions = d.quantityRegions || [
    { id: "qr1", projectName: "合和新城·3 号楼", building: "3 号楼", floorFrom: 1, floorTo: 18,
      unitsPerFloor: 8, unitRule: "楼层+序号（如 0301）", unitPrefix: "", note: "屋面层不计入户数，单独作公区范围。" },
  ];

  d.houseTypeTemplates = d.houseTypeTemplates || [
    { id: "htt1", projectName: "合和新城·3 号楼", code: "A", area: 89.6, borrowFrom: "不借用",
      rooms: ["客厅", "主卧", "次卧", "厨房", "卫生间", "阳台"],
      lines: ["泥水|墙砖粘贴|48.6|50|m²", "泥水|地砖铺贴|28.4|29|m²", "油漆|一遍腻子|92.4|95|m²", "油漆|二遍腻子|92.4|95|m²"],
      note: "" },
    { id: "htt2", projectName: "合和新城·3 号楼", code: "B", area: 76.2, borrowFrom: "A",
      rooms: ["客厅", "主卧", "厨房", "卫生间", "阳台"],
      lines: ["泥水|墙砖粘贴|41.2|42|m²", "泥水|地砖铺贴|24.1|25|m²", "油漆|一遍腻子|78.5|80|m²"],
      note: "由 A 户型快照复制后删掉次卧，之后与 A 互不影响。" },
  ];
})();
