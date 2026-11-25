/* ---- js/plan.js ---- */
/**
 * CLUB.plan —— 活动策划内容引擎（社团活动全流程智能体）
 * 根据活动基本信息生成：策划书 / 场地使用申请表 / 活动通知 / 执行手册 四份 DocSpec，
 * 以及报名表模板（xlsx 数据）、办活动清单与组织者提醒。
 * 纯函数、零依赖、无 DOM、无 Math.random / Date.now，同输入必得同输出。
 * 金额统一以「分」为整数参与运算，保证分项合计与预算总额严格相等。
 */
(function (global) {
  'use strict';

  var DEFAULT_SCALE = 80;
  var WEEK = '日一二三四五六';

  // 活动类型识别：优先匹配更具体的类型，未知类型归入「其他」。
  var TYPE_ALIASES = [
    ['volunteer', /志愿|公益|义工|支教|服务队|volunteer/i],
    ['team', /团建|素拓|拓展|破冰|户外营|team\s*build/i],
    ['recruit', /招新|纳新|招员|招募|会员招|recruit/i],
    ['competition', /比赛|竞赛|大赛|联赛|挑战赛|评比|contest|competition|match/i],
    ['performance', /演出|晚会|音乐会|表演|汇演|话剧|show|performance|concert/i],
    ['exhibition', /展览|展出|作品展|展映|博览会|书画展|exhibition|expo/i],
    ['training', /培训|工作坊|训练营|课程|workshop|training/i],
    ['lecture', /讲座|讲坛|分享会|宣讲|报告会|论坛|读书会|lecture|talk|seminar/i],
    ['salon', /沙龙|茶话|交流会|座谈|圆桌|salon/i]
  ];

  var CATEGORY_DEFS = [
    { key: 'material', label: '物资物料', use: '横幅海报、签到物料、现场耗材与自备物资' },
    { key: 'venue', label: '场地与嘉宾', use: '场地租用、音响投影、桌椅布置、嘉宾课酬与接待' },
    { key: 'promo', label: '宣传印刷', use: '视觉设计、印刷加急、线上推广与短视频' },
    { key: 'prize', label: '奖品礼品', use: '奖项奖品、证书奖杯、参与纪念品' },
    { key: 'food', label: '餐饮茶歇', use: '工作餐、茶歇点心、饮用水补给' },
    { key: 'transport', label: '交通差旅', use: '物资运输、志愿者与嘉宾交通' },
    { key: 'insurance', label: '保险安全', use: '活动保险、急救物资、安全围挡' },
    { key: 'reserve', label: '应急备用', use: '不可预见费、雨具与备用电源' }
  ];

  /* ============================================================
   * 一、十类活动的内容配置
   * ============================================================ */
  var TYPES = {
    lecture: {
      label: '讲座',
      themeWord: '知启新程',
      slogan: '把问题带上，把答案带走',
      visual: '深蓝搭配暖白，版式留白；主标题用黑体加粗，信息层级不超过三级',
      background: '在专业课之外，同学们对跨学科视野、学习方法与行业经验的需求持续增长，但相关信息分散在公众号、群聊和口耳相传中，缺少一次能够系统提问、当场得到回应的面对面交流。{org}结合往期活动反馈，决定举办本次「{name}」，把嘉宾的经验整理成可以带走的方法，而不是一场单向输出。',
      purposes: [
        '围绕「{theme}」搭建一次完整的知识分享场景，让参与者在有限时间内掌握一个可迁移的方法框架。',
        '现场至少留出 20 分钟问答，回应参与者在学习、竞赛或职业规划中的真实困惑。',
        '活动后 3 天内整理图文与问答纪要并通过公众号发布，覆盖未能到场的同学。',
        '沉淀嘉宾联络、设备调试与控场经验，形成社团可复用的讲座执行手册。'
      ],
      flow: [
        { name: '签到入场', role: '现场执行组', weight: 10, content: '核验报名信息，发放讲义与反馈问卷二维码，引导前 3 排就座' },
        { name: '开场介绍', role: '主持人', weight: 8, content: '介绍活动背景、主讲嘉宾与流程，提醒手机静音并说明提问规则' },
        { name: '主题讲座', role: '主讲嘉宾', weight: 42, content: '围绕主题分 3 个部分展开，每部分结束留 2 分钟消化与记录' },
        { name: '互动问答', role: '主持人、主讲嘉宾', weight: 22, content: '按举手、递麦、限时 2 分钟的顺序组织提问，主持人负责控场' },
        { name: '问卷与抽奖', role: '宣传组', weight: 8, content: '引导扫码填写反馈问卷，从提交者中抽取 5 份纪念品' },
        { name: '合影留念', role: '摄影记录组', weight: 5, content: '嘉宾与工作人员、观众分区合影，控制在 3 分钟内' },
        { name: '散场清场', role: '后勤物资组', weight: 5, content: '引导有序离场，归还设备，检查座位区是否有遗留物品' }
      ],
      extraRoles: [
        { role: '嘉宾接待组', count: function () { return 2; }, duty: '嘉宾接送、签到、茶水与课件拷贝', owner: '接待组组长' }
      ],
      materials: [
        { name: '课程讲义', spec: 'A4 双面，含提纲与参考书目', unit: '份', price: 2, qty: function (c) { return Math.ceil(c.scale * 0.6); }, note: '按报名人数六成准备，余量留现场' },
        { name: '嘉宾名牌', spec: '亚克力台签', unit: '个', price: 3, qty: function (c) { return c.guestCount; }, note: '活动前一天写好' },
        { name: '翻页笔电池', spec: '7 号电池', unit: '节', price: 5, qty: function () { return 4; }, note: '备用，防止课件中途断电' }
      ],
      weights: { material: 20, venue: 36, promo: 13, prize: 3, food: 7, transport: 4, insurance: 2, reserve: 9 },
      guestCount: 1,
      guestLabel: '主讲嘉宾 1 名',
      prizeText: '互动纪念品 5 份（笔记本、书签、明信片）',
      promoChannels: ['学院与社团公众号推文（提前 10 天、提前 3 天各 1 篇）', '班级群、年级群与专业群转发，附报名二维码', '教学楼与食堂海报各 2 张，保留至活动结束', '社团会员群公告，安排 3 名成员在群内答疑'],
      risks: [
        { risk: '主讲嘉宾行程临时调整', level: '高', trigger: '活动前 48 小时仍未确认到场时间', action: '立即启用备选嘉宾或改为线上连线，宣传组 2 小时内发布变更说明并同步报名群', owner: '总负责人' },
        { risk: '现场提问冷场', level: '中', trigger: '主持人邀请提问后 10 秒无人举手', action: '启用提前准备的 3 个种子问题，由工作人员率先提问，同时开放匿名提问二维码', owner: '主持人' },
        { risk: '讲座内容超时', level: '中', trigger: '主体讲座超出计划结束时间 15 分钟', action: '计时员举牌提醒，主持人用「最后一个问题」收束，压缩合影与散场环节', owner: '策划组' }
      ],
      metrics: [
        { name: '现场提问数', target: '≥ 8 个', method: '主持人记录提问人数与问题数量' },
        { name: '推文阅读量', target: '≥ {readTarget} 人次', method: '公众号后台数据，活动后 3 天统计' }
      ],
      prep: {
        t7: ['与主讲嘉宾确认课件版本、时长与设备接口'],
        t3: ['收集参与者想提问的问题，整理成提问清单交给主持人'],
        t1: ['测试翻页笔、录音设备与备用电脑，课件同时拷贝到两台设备'],
        day: ['活动开始前 30 分钟再次调试投影与话筒，准备无设备预案']
      },
      noticePoints: ['请提前 15 分钟签到入场，讲座期间将手机调至静音', '现场提供讲义，数量按报名顺序发放，先到先得'],
      venueNeeds: '投影仪、无线话筒 2 支、翻页笔、录音设备',
      handbookNotes: ['主讲嘉宾到场后先确认课件页码与话筒电量', '问答环节安排 1 名工作人员专职递麦'],
      checkExtra: '活动前 7 天：与主讲嘉宾确认课件版本、现场设备接口与问答偏好'
    },

    competition: {
      label: '比赛',
      themeWord: '以赛促学',
      slogan: '同台竞技，各展所长',
      visual: '活力橙搭配深灰，数字与赛程用粗体突出，避免过多装饰',
      background: '竞赛是检验学习成果、激发学习动力的有效方式。在{org}往届同类赛事中，报名同学普遍希望赛制更清晰、评分更公平、展示机会更充分。本次「{name}」设置初赛展示与决赛实操两轮，邀请评委现场打分并公开点评，让比赛成为一次可以复盘的学习过程。',
      purposes: [
        '以赛促学，围绕「{theme}」设置贴近课程与校园实际的赛题，让参赛者在备赛与现场比拼中补齐知识短板。',
        '建立可解释的评分体系，评分维度、权重与申诉渠道在赛前公示，确保结果公开透明。',
        '为优秀作品提供展示与推优渠道，赛后通过公众号发布获奖名单与作品集。',
        '沉淀赛事组织流程、评分表与应急方案，形成社团可复用的办赛手册。'
      ],
      flow: [
        { name: '签到与抽签', role: '现场执行组', weight: 10, content: '选手签到、核验学生证，抽签确定出场顺序并张贴到候场区' },
        { name: '开幕与规则说明', role: '主持人', weight: 8, content: '介绍评委、赛制、评分维度、计时规则与申诉渠道' },
        { name: '初赛展示', role: '评委组', weight: 28, content: '选手按顺序展示，每队 8 分钟展示加 3 分钟答辩' },
        { name: '决赛实操', role: '评委组', weight: 26, content: '晋级选手完成指定任务，计时员同步计时并公示剩余时间' },
        { name: '评委点评与统分', role: '评委组、计分组', weight: 10, content: '评委集中点评，计分组双人复核分数并签字' },
        { name: '颁奖', role: '主持人', weight: 10, content: '公布名次，邀请嘉宾颁奖，获奖者合影' },
        { name: '合影与散场', role: '摄影记录组、后勤物资组', weight: 8, content: '全体合影，选手有序离场，撤场并清点设备' }
      ],
      extraRoles: [
        { role: '评委组', count: function () { return 3; }, duty: '独立打分、现场点评、处理评分异议', owner: '评委组组长' },
        { role: '计分组', count: function () { return 2; }, duty: '双人录入与复核分数，维护统分表', owner: '计分组组长' },
        { role: '计时组', count: function () { return 1; }, duty: '按环节计时、举牌提醒并记录超时', owner: '计时员' }
      ],
      materials: [
        { name: '参赛号码牌', spec: 'A5 双面，含姓名与编号', unit: '个', price: 1, qty: function (c) { return Math.ceil(c.scale * 0.6); }, note: '按参赛人数准备' },
        { name: '评分表', spec: 'A4，按评分维度排版', unit: '张', price: 0.2, qty: function () { return 12; }, note: '每位评委每轮一张' },
        { name: '抽签箱', spec: '不透明纸箱', unit: '个', price: 20, qty: function () { return 1; }, note: '赛前封箱检查' },
        { name: '计时器', spec: '电子计时器带提示音', unit: '个', price: 30, qty: function () { return 1; }, note: '另备手机秒表' }
      ],
      weights: { material: 10, venue: 26, promo: 10, prize: 30, food: 8, transport: 4, insurance: 4, reserve: 10 },
      guestCount: 3,
      guestLabel: '评委 3 名',
      prizeText: '一等奖 1 名、二等奖 2 名、三等奖 3 名，另设优秀奖若干',
      promoChannels: ['班级群与专业群发布赛制与报名通道', '公众号推送赛事预告、赛程表和晋级榜', '教学楼、实验楼海报各 2 张', '比赛当天发布短视频花絮与获奖名单'],
      risks: [
        { risk: '评分争议', level: '高', trigger: '选手对分数提出异议且情绪激动', action: '暂停该环节，由评委组组长出示评分表并逐项说明，争议无法解决时提交指导老师裁定', owner: '评委组组长' },
        { risk: '计时或计分设备故障', level: '中', trigger: '计时器失灵或统分表数据不一致', action: '立即改用备用计时器与纸质计分表，计分组双人复核，向选手说明处理过程', owner: '计时组' },
        { risk: '选手缺席或迟到', level: '中', trigger: '叫号后 3 分钟未到场', action: '按抽签顺序顺延一位，联系选手确认；开赛 10 分钟仍未到场视为弃权并记录', owner: '现场执行组' }
      ],
      metrics: [
        { name: '参赛队伍数', target: '≥ {teamTarget} 支', method: '报名表与签到表核对，赛后汇总' },
        { name: '评分复核差错', target: '0 处', method: '计分组双人复核并签字存档' }
      ],
      prep: {
        t7: ['发布赛制、评分细则与申诉办法，开放报名'],
        t3: ['完成报名统计与抽签，组织评委沟通会并试评'],
        t1: ['打印评分表、签到表与号码牌，调试计时器与计分板'],
        day: ['赛前 40 分钟召开评委会，统一评分尺度与点评顺序']
      },
      noticePoints: ['参赛选手须提前 30 分钟到场签到并抽签', '对评分有异议的，须在结果公布后 10 分钟内书面提出', '比赛期间请保持候场区安静，不得干扰其他选手'],
      venueNeeds: '投影仪、计时器、无线话筒 2 支、计分板、评委席桌牌',
      handbookNotes: ['评委席与计分席分开设置，避免相互影响', '每轮结束立即封存评分表，统分时双人在场'],
      checkExtra: '活动前 3 天：组织评委沟通会，完成评分细则试评与统分演练'
    },

    performance: {
      label: '演出',
      themeWord: '青春舞台',
      slogan: '灯光亮起，青春登场',
      visual: '暗夜紫搭配鎏金，节目单用大字号，舞台背景简洁不抢节目',
      background: '校园文艺演出是社团展示成果、同学放松交流的重要场景。{org}在往期排练和演出中发现，节目质量之外，观众更在意入场是否顺畅、节目衔接是否紧凑、现场氛围是否被照顾到。本次「{name}」以节目单为主线，设置上下半场与中场互动，让每个节目都有完整的呈现时间。',
      purposes: [
        '围绕「{theme}」呈现一台结构完整的校园演出，让社团成员的排练成果被看见。',
        '通过节目审查、联排与带妆彩排，提升节目完成度和舞台配合熟练度。',
        '设计上下半场与中场互动，控制整体节奏，避免观众疲劳。',
        '留存剧照、视频与节目单，为后续招新和品牌活动积累素材。'
      ],
      flow: [
        { name: '观众入场', role: '检票引导组', weight: 10, content: '检票、引导入座，循环播放暖场视频与安全提示' },
        { name: '开场节目', role: '舞台监督组', weight: 10, content: '开场舞或乐队暖场，主持人登场报幕' },
        { name: '上半场节目', role: '舞台监督组', weight: 26, content: '按节目单演出，舞台监督提前两个节目催场' },
        { name: '互动与抽奖', role: '主持人', weight: 14, content: '号码抽奖与观众互动，穿插社团介绍' },
        { name: '下半场节目', role: '舞台监督组', weight: 24, content: '继续演出，压轴节目结束后全体演员上台' },
        { name: '合影留念', role: '摄影记录组', weight: 6, content: '演职人员与观众合影，灯光配合保持 3 分钟' },
        { name: '散场与撤场', role: '后勤物资组', weight: 10, content: '分区疏散观众，归还租赁设备与服装并签字确认' }
      ],
      extraRoles: [
        { role: '舞台监督组', count: function () { return 3; }, duty: '催场、灯光音响口令、节目衔接', owner: '舞台监督' },
        { role: '节目统筹组', count: function () { return 2; }, duty: '节目审查、排练排期、演员联络', owner: '节目统筹' },
        { role: '检票引导组', count: function () { return 3; }, duty: '检票、分区引导、维持入场秩序', owner: '引导组组长' }
      ],
      materials: [
        { name: '节目单', spec: 'A5 双面彩色', unit: '份', price: 1, qty: function (c) { return c.scale; }, note: '按观众人数准备' },
        { name: '荧光棒', spec: '一次性，含电池款少量', unit: '根', price: 1, qty: function (c) { return c.scale; }, note: '入场时发放' },
        { name: '对讲机', spec: '含耳麦，提前充满电', unit: '台', price: 30, qty: function () { return 4; }, note: '舞台、入口、后台、机动各 1 台' },
        { name: '化妆与卸妆用品', spec: '共用装，含棉片', unit: '套', price: 50, qty: function () { return 1; }, note: '后台化妆间使用' }
      ],
      weights: { material: 14, venue: 26, promo: 13, prize: 5, food: 9, transport: 6, insurance: 7, reserve: 10 },
      guestCount: 1,
      guestLabel: '指导老师与演出嘉宾',
      prizeText: '现场抽奖礼品 10 份，优秀节目证书 3 本',
      promoChannels: ['公众号发布节目单与演职人员介绍', '短视频平台发布排练花絮与倒计时', '班级群与宿舍群转发抢票信息', '校园广播与海报联动预热'],
      risks: [
        { risk: '节目临时取消', level: '高', trigger: '演出前 24 小时有节目无法参演', action: '启用备选节目并调整节目单，主持人准备过渡串词，宣传口径同步更新', owner: '节目统筹' },
        { risk: '舞台用电与设备安全', level: '高', trigger: '出现跳闸、线路发热或设备异响', action: '立即切断该路电源，由场地电工排查；禁止非专业人员私自接线，必要时压缩灯光效果', owner: '舞台监督' },
        { risk: '观众拥挤', level: '中', trigger: '入口排队超过 50 人或通道被占用', action: '增开检票口，启用分批入场，安全组在通道定点疏导', owner: '安全保障组' },
        { risk: '演出超时', level: '中', trigger: '单个节目超出计划 3 分钟', action: '舞台监督举牌提示，压缩互动环节时长，保证散场时间不晚于场地闭馆时间', owner: '舞台监督' }
      ],
      metrics: [
        { name: '节目完成率', target: '100%', method: '对照节目单逐项确认，记录临时调整' },
        { name: '观众上座率', target: '≥ 85%', method: '入场检票数与场地座位数之比' }
      ],
      prep: {
        t7: ['完成节目一审，确定节目单初稿与备选节目'],
        t3: ['组织联排，确认灯光、音响、道具与换场动线'],
        t1: ['带妆彩排与设备联调，确认服装道具清单'],
        day: ['提前 3 小时进场，完成舞台搭建、调音与安全检查']
      },
      noticePoints: ['凭报名信息入场，一人一票，请勿携带易燃易爆物品', '演出期间请关闭闪光灯，掌声与欢呼请配合节目节奏', '散场按区域分批离场，请听从工作人员引导'],
      venueNeeds: '舞台灯光、专业音响、无线话筒 4 支、投影或 LED 屏、后台化妆间',
      handbookNotes: ['后台设置服装道具清点表，演出结束后逐项归还', '每个节目结束后预留 30 秒换场，舞台监督用对讲机统一口令'],
      checkExtra: '活动前 3 天：完成节目联排，确认灯光音响口令与备选节目'
    },

    salon: {
      label: '沙龙',
      themeWord: '围坐而谈',
      slogan: '一杯茶的时间，交换一种看世界的方式',
      visual: '暖米色搭配墨绿，圆桌围坐布局，物料以卡片和手写风为主',
      background: '相比大型讲座，小规模沙龙更容易让每个人开口。{org}在会员交流中发现，同学们对「能坐下来聊透一个问题」的场景需求明显，但现有活动多为单向输出。本次「{name}」控制规模、布置圆桌、准备话题卡，让分享与讨论各占一半时间。',
      purposes: [
        '围绕「{theme}」设置 3 个具体议题，让每位参与者在讨论环节至少发言一次。',
        '用话题卡和引导员控制讨论方向，避免跑题与少数人主导。',
        '形成一份讨论纪要，活动后发布在社团公众号与会员群。',
        '探索小规模、低成本的交流活动模式，为后续系列沙龙积累经验。'
      ],
      flow: [
        { name: '签到与自由交流', role: '现场执行组', weight: 14, content: '领取话题卡与饮品，按兴趣标签入座，播放轻音乐' },
        { name: '开场破冰', role: '主持人', weight: 10, content: '自我介绍接龙，抛出 3 个核心议题并说明讨论规则' },
        { name: '主题分享', role: '分享嘉宾', weight: 26, content: '2 位嘉宾各分享 12 分钟，控制在 25 分钟内' },
        { name: '圆桌讨论', role: '主持人、引导员', weight: 24, content: '分 3 组讨论，每组 1 名引导员记录观点与分歧' },
        { name: '自由提问', role: '主持人', weight: 12, content: '开放提问，收集 5 个高频问题并现场回应' },
        { name: '合影留念', role: '摄影记录组', weight: 5, content: '围坐合影，记录话题卡与板书' },
        { name: '散场清场', role: '后勤物资组', weight: 9, content: '归还桌椅，清理茶歇，回收可复用物料' }
      ],
      extraRoles: [
        { role: '引导员组', count: function () { return 3; }, duty: '分组讨论引导、记录观点、控制发言时长', owner: '引导员组组长' }
      ],
      materials: [
        { name: '话题卡', spec: 'A6 卡纸，双面印刷', unit: '张', price: 0.5, qty: function (c) { return c.scale; }, note: '每桌一套，含 3 个议题' },
        { name: '便签纸', spec: '76mm 方形，多色', unit: '本', price: 5, qty: function () { return 2; }, note: '记录观点与投票' },
        { name: '桌布', spec: '纯色棉麻，可重复使用', unit: '块', price: 15, qty: function () { return 4; }, note: '社团库存不足时借用' },
        { name: '马克笔', spec: '可擦写，粗头', unit: '支', price: 8, qty: function () { return 6; }, note: '每组 2 支' }
      ],
      weights: { material: 12, venue: 26, promo: 9, prize: 3, food: 30, transport: 4, insurance: 2, reserve: 10 },
      guestCount: 2,
      guestLabel: '分享嘉宾 2 名',
      prizeText: '互动小礼品 5 份（书签、咖啡券）',
      promoChannels: ['会员群与兴趣群定向招募，限额报名', '公众号发布议题与嘉宾介绍', '海报张贴于咖啡角与自习室', '邀请往期参与者转发，设置推荐名额'],
      risks: [
        { risk: '讨论跑题', level: '中', trigger: '小组讨论偏离议题超过 5 分钟', action: '引导员举牌提醒，用话题卡上的追问把讨论拉回主线，必要时调整分组', owner: '引导员组组长' },
        { risk: '茶歇准备不足', level: '中', trigger: '开场后 30 分钟茶歇消耗超过七成', action: '后勤组立即补充饮用水与点心，按人均标准控制发放', owner: '后勤物资组' },
        { risk: '嘉宾观点冲突', level: '中', trigger: '讨论出现人身攻击或激烈争执', action: '主持人立即打断并重申讨论规则，将争议点记录后转入书面回应', owner: '主持人' }
      ],
      metrics: [
        { name: '人均发言次数', target: '≥ 1 次', method: '引导员记录每组发言人次，除以到场人数' },
        { name: '讨论纪要产出', target: '1 份', method: '活动后 2 天内整理并发布' }
      ],
      prep: {
        t7: ['确认分享嘉宾与议题，发出议题征集问卷'],
        t3: ['根据报名兴趣标签完成分组，培训引导员'],
        t1: ['采购茶歇、打印话题卡，完成桌椅与音响布置'],
        day: ['提前 1 小时布置圆桌与茶歇区，测试背景音乐']
      },
      noticePoints: ['活动限额报名，请确认能到场后再提交', '现场提供茶歇，如有饮食禁忌请在报名表中注明', '鼓励带着一个真实问题来，讨论环节请积极发言'],
      venueNeeds: '可移动圆桌 4 张、座椅 20 把、无线话筒 1 支、白板、背景音乐音响',
      handbookNotes: ['圆桌间距保留 1 米以上，方便引导员走动', '茶歇区与讨论区分开，避免取餐打断讨论'],
      checkExtra: '活动前 3 天：完成报名分组与引导员培训，确认茶歇数量与饮食禁忌'
    },

    volunteer: {
      label: '志愿服务',
      themeWord: '微光成炬',
      slogan: '把善意落到实处',
      visual: '青绿色搭配白色，突出服务标识与安全提示，避免复杂装饰',
      background: '志愿服务是把公益想法落地的直接方式，但服务效果往往取决于前期对接、岗前培训和安全保障是否到位。{org}本次「{name}」在服务前统一培训、服务中分组巡查、服务后记录时长，让参与者知道做什么、怎么做、遇到问题找谁。',
      purposes: [
        '围绕「{theme}」完成一次有明确服务对象和任务清单的志愿行动。',
        '通过岗前培训与安全交底，确保每位志愿者清楚服务规范与应急流程。',
        '如实记录服务时长与服务对象反馈，为志愿者证明和社团档案提供依据。',
        '形成服务点联络表与风险清单，提升社团后续公益活动的组织能力。'
      ],
      flow: [
        { name: '集合签到与分组', role: '现场执行组', weight: 12, content: '集合点名，发放马甲与任务卡，按服务点分组并指定组长' },
        { name: '岗前培训与安全交底', role: '安全保障组', weight: 12, content: '讲解服务规范、交通路线与应急处置，签署安全须知' },
        { name: '志愿服务开展', role: '各组组长', weight: 40, content: '按点位开展服务，组长每 30 分钟巡查一次并记录问题' },
        { name: '轮岗休息', role: '后勤物资组', weight: 8, content: '分批轮换，补充饮水，记录服务时长' },
        { name: '服务收尾与成果整理', role: '策划组', weight: 12, content: '清点物资、汇总服务数据与影像，向服务单位反馈' },
        { name: '合影与总结', role: '摄影记录组', weight: 8, content: '服务点合影，现场进行 3 分钟总结' },
        { name: '返程与清点', role: '安全保障组', weight: 8, content: '清点人数，确认全员返程后解散' }
      ],
      extraRoles: [
        { role: '志愿者管理组', count: function () { return 2; }, duty: '志愿者分组、考勤、时长记录与联络', owner: '志愿者管理组组长' }
      ],
      materials: [
        { name: '志愿者马甲', spec: '统一标识，可回收', unit: '件', price: 15, qty: function (c) { return Math.ceil(c.scale * 0.6); }, note: '活动后回收清点' },
        { name: '防护手套', spec: '一次性丁腈手套', unit: '双', price: 3, qty: function (c) { return c.scale; }, note: '按服务内容发放' },
        { name: '急救包', spec: '含创可贴、碘伏、纱布', unit: '套', price: 50, qty: function () { return 1; }, note: '每个服务点 1 套' },
        { name: '口哨', spec: '户外联络用', unit: '个', price: 5, qty: function () { return 4; }, note: '每个组长 1 个' }
      ],
      weights: { material: 16, venue: 9, promo: 8, prize: 6, food: 8, transport: 26, insurance: 14, reserve: 9 },
      guestCount: 0,
      guestLabel: '',
      prizeText: '优秀志愿者证书与纪念徽章',
      promoChannels: ['志愿平台与社团公众号发布招募', '班级群与学院群转发服务岗位说明', '海报突出服务时间、地点与保障措施', '邀请往期志愿者分享服务故事'],
      risks: [
        { risk: '交通与人身安全', level: '高', trigger: '志愿者在往返途中或服务点发生交通事故、摔伤', action: '立即联系 120 与家长，安全组陪护就医，同步上报指导老师并启动保险理赔', owner: '安全保障组' },
        { risk: '与服务对象沟通冲突', level: '中', trigger: '志愿者与服务对象出现误解或争执', action: '组长第一时间介入分隔双方，由服务单位负责人协调，必要时调整岗位', owner: '志愿者管理组' },
        { risk: '天气突变', level: '中', trigger: '户外服务开始前 2 小时出现降雨、高温预警', action: '启用室内备用岗位或顺延，准备雨衣与防暑物资，提前通知志愿者', owner: '总负责人' }
      ],
      metrics: [
        { name: '累计服务时长', target: '≥ {serviceHours} 小时', method: '按签到与签退时间统计，组长复核' },
        { name: '安全事件', target: '0 起', method: '安全组巡查记录与应急台账' }
      ],
      prep: {
        t7: ['与服务单位确认岗位、人数与具体任务'],
        t3: ['完成志愿者分组与岗前培训，收集紧急联系人信息'],
        t1: ['确认交通方式与集合点，发放马甲与任务卡'],
        day: ['出发前清点人数，服务结束后确认全员返程']
      },
      noticePoints: ['请统一穿着志愿者马甲，听从组长安排，不得独自离队', '服务期间如身体不适或遇到突发情况，立即联系组长', '服务时长以签到签退为准，请按时到场'],
      venueNeeds: '集合场地、桌椅、遮阳或避雨设施、饮用水补给点',
      handbookNotes: ['每个服务点指定 1 名安全联络人，保持手机畅通', '服务结束后 24 小时内完成时长录入与公示'],
      checkExtra: '活动前 3 天：完成志愿者分组、安全培训与紧急联系人登记'
    },

    team: {
      label: '团建',
      themeWord: '同行共进',
      slogan: '一个人走得快，一群人走得远',
      visual: '明黄搭配藏蓝，动感排版，安全提示放在显眼位置',
      background: '社团成员来自不同年级和专业，日常协作多、彼此了解少。{org}本次「{name}」用半天时间完成破冰、两项团队任务和复盘分享，让成员在具体任务中建立信任，也借机梳理下一阶段的分工。',
      purposes: [
        '围绕「{theme}」设计两项需要协作完成的团队任务，让成员在行动中熟悉彼此。',
        '通过复盘分享，形成下一阶段社团工作的分工建议。',
        '在活动前完成安全告知与保险购买，确保户外或高强度环节风险可控。',
        '沉淀团建流程与安全预案，作为新成员融入的固定环节。'
      ],
      flow: [
        { name: '集合签到', role: '现场执行组', weight: 10, content: '集合点名、发放号码背心，说明全天安排与安全要求' },
        { name: '破冰分组', role: '教练带队组', weight: 14, content: '随机分组、起队名画队旗，完成 10 分钟破冰游戏' },
        { name: '团队项目一', role: '教练带队组', weight: 24, content: '同心鼓或接力挑战，讲解规则、示范并强调安全边界' },
        { name: '团队项目二', role: '教练带队组', weight: 22, content: '需要分工与沟通的协作任务，每组配 1 名带队人员' },
        { name: '总结分享与颁奖', role: '主持人', weight: 12, content: '各组复盘 3 分钟，公布优胜团队并颁发奖品' },
        { name: '合影留念', role: '摄影记录组', weight: 6, content: '全体与队旗合影，拍摄小组创意照' },
        { name: '散场与用餐', role: '后勤物资组', weight: 12, content: '清点物资、回收背心，按分组用餐并确认返程' }
      ],
      extraRoles: [
        { role: '教练带队组', count: function () { return 3; }, duty: '规则讲解、项目示范、分组带队与安全保护', owner: '教练组组长' }
      ],
      materials: [
        { name: '队旗', spec: '空白旗帜含画笔', unit: '面', price: 15, qty: function (c) { return Math.max(4, Math.ceil(c.scale / 10)); }, note: '每组 1 面' },
        { name: '拓展道具', spec: '同心鼓、接力道具等', unit: '套', price: 20, qty: function () { return 1; }, note: '优先借用社团库存' },
        { name: '医药包', spec: '含扭伤喷雾、创可贴', unit: '套', price: 50, qty: function () { return 1; }, note: '带队人员随身携带' },
        { name: '号码背心', spec: '分队颜色，可回收', unit: '件', price: 8, qty: function (c) { return c.scale; }, note: '按人数准备' }
      ],
      weights: { material: 16, venue: 16, promo: 5, prize: 8, food: 22, transport: 12, insurance: 12, reserve: 9 },
      guestCount: 1,
      guestLabel: '拓展教练 1 名',
      prizeText: '优胜团队奖品 3 份，参与纪念品按人数准备',
      promoChannels: ['会员群发布活动预告与报名接龙', '公众号回顾往期团建照片', '班级群定向邀请新成员', '活动后发布合影与复盘推文'],
      risks: [
        { risk: '运动损伤', level: '高', trigger: '成员在项目中扭伤、擦伤或中暑', action: '立即停止该项目，由带队人员用医药包处理，严重时送校医院并通知家长', owner: '教练组组长' },
        { risk: '天气突变', level: '中', trigger: '活动当天出现降雨、大风或高温预警', action: '启用室内备用场地或调整项目顺序，准备雨衣与防暑饮品', owner: '总负责人' },
        { risk: '成员掉队', level: '中', trigger: '集合点名缺人且 5 分钟内联系不上', action: '立即停止转场，按最后见到的位置分组寻找，同时联系场地管理方广播', owner: '安全保障组' }
      ],
      metrics: [
        { name: '成员参与率', target: '≥ 90%', method: '签到人数除以社团在册人数' },
        { name: '安全事件', target: '0 起', method: '带队人员活动后提交安全记录' }
      ],
      prep: {
        t7: ['确认场地、教练与项目清单，购买活动保险'],
        t3: ['统计参与人数与饮食禁忌，完成分组'],
        t1: ['检查道具与医药包，召开安全说明会'],
        day: ['提前 1 小时到场布置，检查场地边界与湿滑区域']
      },
      noticePoints: ['请穿运动鞋与便于活动的服装，勿佩戴尖锐饰品', '如有心脏病、哮喘、近期扭伤等情况请提前告知', '活动期间请听从教练与带队人员安排，不得擅自离队'],
      venueNeeds: '户外草坪或体育馆、遮阳棚、音响、饮用水、急救点',
      handbookNotes: ['每个项目开始前重复安全边界与停止手势', '医药包由安全组随身携带，不放在固定点位'],
      checkExtra: '活动前 3 天：确认参与者健康状况与保险名单，完成安全告知'
    },

    recruit: {
      label: '招新',
      themeWord: '等你入列',
      slogan: '在社团，遇见更大的自己',
      visual: '亮橙搭配白色，信息密度高但分区清晰，二维码放在视觉中心',
      background: '招新是社团补充新成员、延续品牌活动的关键节点。{org}往年的问题是摊位前咨询多、真正填表少，报名信息也不完整。本次「{name}」把宣讲、部门介绍、现场咨询和扫码报名串成一条动线，并安排老成员一对一答疑。',
      purposes: [
        '围绕「{theme}」完成一次完整的招新，现场咨询与线上报名同步进行。',
        '用部门介绍和往期活动展示，让同学在 3 分钟内了解社团能提供什么。',
        '规范报名信息采集，为后续面试与分组提供完整名单。',
        '形成招新物料包与答疑手册，降低下一届筹备成本。'
      ],
      flow: [
        { name: '摊位布置与签到', role: '后勤物资组', weight: 14, content: '提前到场搭展架、摆桌、张贴海报，调试二维码与音响' },
        { name: '开场宣讲', role: '主持人', weight: 12, content: '介绍社团历史、品牌活动与部门设置，控制在 10 分钟' },
        { name: '部门介绍', role: '各部门负责人', weight: 22, content: '各部门 3 分钟介绍职责、招新要求与成长路径' },
        { name: '现场咨询与报名', role: '咨询面试组', weight: 28, content: '一对一答疑，指导扫码填写报名表并核对关键信息' },
        { name: '自由交流', role: '老成员', weight: 12, content: '老成员分享参与体验，解答课程与时间安排疑问' },
        { name: '合影留念', role: '摄影记录组', weight: 6, content: '工作人员与部分新同学合影，留存招新素材' },
        { name: '撤场与统计', role: '现场执行组', weight: 6, content: '回收展架、清点物资，当晚统计报名人数与来源' }
      ],
      extraRoles: [
        { role: '咨询面试组', count: function () { return 4; }, duty: '现场答疑、指导填表、初筛与面试安排', owner: '咨询组组长' }
      ],
      materials: [
        { name: '招新展架', spec: '80cm×180cm，含社团介绍', unit: '个', price: 80, qty: function () { return 2; }, note: '可重复使用' },
        { name: '宣传单', spec: 'A5 彩色双面', unit: '张', price: 0.2, qty: function (c) { return Math.ceil(c.scale * 2); }, note: '按预计咨询量准备' },
        { name: '报名二维码立牌', spec: '亚克力台卡', unit: '个', price: 20, qty: function () { return 1; }, note: '报名表链接提前测试' },
        { name: '桌布', spec: '社团统一色', unit: '块', price: 15, qty: function () { return 2; }, note: '遮盖摊位桌' }
      ],
      weights: { material: 14, venue: 16, promo: 30, prize: 4, food: 3, transport: 3, insurance: 2, reserve: 10 },
      guestCount: 0,
      guestLabel: '',
      prizeText: '咨询小礼品按报名人数准备（贴纸、书签）',
      promoChannels: ['新生群与班级群发布招新长图与报名入口', '公众号推送部门介绍与往期活动集锦', '食堂、宿舍楼下张贴海报与二维码', '老成员朋友圈统一转发，设置推荐有礼'],
      risks: [
        { risk: '报名人数过少', level: '中', trigger: '招新开始 2 小时后报名不足预期的一半', action: '延长摆摊时间，加派成员到人流密集区发单，当晚追加线上推送', owner: '宣传组组长' },
        { risk: '现场秩序混乱', level: '中', trigger: '摊位前同时聚集超过 20 人', action: '设置排队引导线，分设咨询区与填表区，安排 2 名成员维持秩序', owner: '安全保障组' },
        { risk: '报名信息填写错误', level: '中', trigger: '统计时发现手机号、学号缺失或格式错误', action: '当晚导出名单逐条核对，通过报名群私信补录，48 小时内完成', owner: '咨询面试组' }
      ],
      metrics: [
        { name: '报名转化率', target: '≥ 60%', method: '报名人数除以现场咨询人数' },
        { name: '信息完整率', target: '≥ 95%', method: '报名表必填项完整度统计' }
      ],
      prep: {
        t7: ['确定招新岗位与人数，完成海报、展架与报名表设计'],
        t3: ['发布招新预告，统计线上预报名'],
        t1: ['打印宣传单、测试报名二维码，召开摊位人员培训'],
        day: ['提前 1 小时到场布置摊位，检查音响与二维码']
      },
      noticePoints: ['请携带学生证或校园卡，现场填写报名信息', '报名后请留意短信或群通知，面试安排将在 3 天内公布', '摊位开放时间为活动当天 10:00—16:00，可错峰前来'],
      venueNeeds: '摊位桌 2 张、展架 2 个、电源、遮阳棚',
      handbookNotes: ['报名表二维码准备 2 个入口，防止单一链接卡顿', '每 2 小时汇总一次报名人数，及时调整宣传话术'],
      checkExtra: '活动前 3 天：完成报名表测试与摊位人员答疑培训'
    },

    training: {
      label: '培训',
      themeWord: '学以致用',
      slogan: '带着问题来，带着方法走',
      visual: '靛蓝搭配浅灰，模块化排版，练习页留出手写空间',
      background: '技能类活动最容易出现「听懂但不会做」。{org}本次「{name}」采用讲授加实操的结构，每个知识点后立即安排练习，由助教巡回指导，最后用成果展示检验学习效果。',
      purposes: [
        '围绕「{theme}」完成一次从知识输入到动手输出的完整培训。',
        '保证每位学员都有独立操作时间，助教按 5 人一组巡回指导。',
        '通过成果展示与点评，让学员明确下一步练习方向。',
        '形成讲义、练习素材与常见问题清单，可复用于下一期培训。'
      ],
      flow: [
        { name: '签到与分组', role: '现场执行组', weight: 10, content: '签到、发放学员手册，按 5 人一组入座并选出组长' },
        { name: '课程导入', role: '主持人', weight: 8, content: '介绍讲师、课程目标与考核方式，收集学员预期' },
        { name: '专题讲授', role: '授课讲师', weight: 26, content: '按模块讲解核心方法，每个模块不超过 25 分钟' },
        { name: '实操练习', role: '助教组', weight: 28, content: '按组完成练习任务，助教巡回指导并记录共性问题' },
        { name: '成果展示与点评', role: '授课讲师、助教', weight: 14, content: '每组展示 3 分钟，讲师逐组点评并给出改进建议' },
        { name: '合影与发证', role: '摄影记录组', weight: 6, content: '合影并发放结业证书，收集反馈问卷' },
        { name: '散场与整理', role: '后勤物资组', weight: 8, content: '回收设备与教具，整理练习作品并归档' }
      ],
      extraRoles: [
        { role: '助教组', count: function () { return 3; }, duty: '练习指导、共性答疑、考核记录', owner: '助教组组长' }
      ],
      materials: [
        { name: '学员手册', spec: 'A4 胶装，含讲义与练习页', unit: '份', price: 5, qty: function (c) { return c.scale; }, note: '按报名人数准备' },
        { name: '结业证书', spec: 'A4 铜版纸', unit: '张', price: 3, qty: function (c) { return c.scale; }, note: '完成考核后发放' },
        { name: '白板纸', spec: 'A2 可粘贴', unit: '张', price: 5, qty: function () { return 4; }, note: '小组展示使用' },
        { name: '马克笔', spec: '黑色与彩色', unit: '支', price: 8, qty: function () { return 6; }, note: '每组 2 支' }
      ],
      weights: { material: 14, venue: 38, promo: 8, prize: 3, food: 8, transport: 5, insurance: 4, reserve: 10 },
      guestCount: 2,
      guestLabel: '授课讲师 2 名',
      prizeText: '优秀学员奖品 3 份，结业证书按人数准备',
      promoChannels: ['公众号发布课程大纲与讲师介绍', '班级群与专业群定向招募', '海报突出实操成果与结业证书', '往期学员作品展示与口碑转发'],
      risks: [
        { risk: '设备或网络故障', level: '中', trigger: '投影、网络或教学软件在开课前无法使用', action: '启用离线素材与备用电脑，助教分发纸质练习，必要时调整实操顺序', owner: '后勤物资组' },
        { risk: '学员基础差异大', level: '中', trigger: '练习环节超过三分之一学员无法独立完成', action: '助教按组提供分层任务，讲师集中补讲一个最小示例，保证每人完成基础任务', owner: '助教组组长' },
        { risk: '课程超时', level: '中', trigger: '实操环节超出计划 15 分钟', action: '压缩展示数量，改为每组代表展示，未展示作品课后线上点评', owner: '策划组' }
      ],
      metrics: [
        { name: '结业率', target: '≥ 90%', method: '完成全部练习并通过考核的人数比例' },
        { name: '成果产出', target: '≥ {workTarget} 份', method: '清点提交的练习作品并归档' }
      ],
      prep: {
        t7: ['确定课程大纲、讲师与练习素材，发布报名'],
        t3: ['按学员基础分组，培训助教并试做练习'],
        t1: ['打印学员手册与证书，测试教学设备与软件'],
        day: ['提前 1 小时布置分组座位，发放教具并测试投屏']
      },
      noticePoints: ['请自带笔记本电脑（如课程需要），并提前安装指定软件', '培训包含实操环节，请全程参与，完成后发放结业证书', '如需请假请提前 1 天联系负责人，以便调整分组'],
      venueNeeds: '投影、无线话筒、可移动桌椅、稳定网络、电源插排',
      handbookNotes: ['助教提前 30 分钟到场，按组摆放教具', '每组指定 1 名组长负责考勤与作品收集'],
      checkExtra: '活动前 3 天：完成助教培训与练习素材试做，确认设备兼容性'
    },

    exhibition: {
      label: '展览',
      themeWord: '看见创意',
      slogan: '让作品被看见，让灵感被分享',
      visual: '留白为主，作品即视觉中心；标签使用统一字级与灰色说明',
      background: '作品只有被看见，交流才会发生。{org}本次「{name}」集中展出成员作品，配合作者导览与现场投票，让观众不只拍照打卡，也能了解作品背后的想法。展览同时是社团成果的一次公开检验。',
      purposes: [
        '围绕「{theme}」集中呈现成员作品，保证每件作品有完整标签与说明。',
        '通过作者导览，让观众理解创作过程，而不只是观看结果。',
        '设置现场投票，评选人气作品，提升观众参与感。',
        '积累展陈物料与布展经验，形成社团年度成果展的固定流程。'
      ],
      flow: [
        { name: '布展与签到', role: '布展组', weight: 10, content: '提前完成展板与灯光布置，签到并发放导览图' },
        { name: '开幕致辞', role: '主持人', weight: 8, content: '介绍展览主题、作品数量与观展规则' },
        { name: '自由观展', role: '现场执行组', weight: 32, content: '观众自由参观，工作人员在重点展区引导' },
        { name: '作者导览', role: '参展作者', weight: 20, content: '作者分时段讲解作品，每件作品控制在 3 分钟' },
        { name: '互动投票', role: '宣传组', weight: 14, content: '发放投票贴纸，统计人气作品并现场公布' },
        { name: '合影留念', role: '摄影记录组', weight: 6, content: '参展作者与工作人员合影' },
        { name: '撤展与清点', role: '布展组', weight: 10, content: '按编号撤下作品、归还展具，核对作品数量' }
      ],
      extraRoles: [
        { role: '布展组', count: function () { return 3; }, duty: '展板搭建、作品陈列、灯光与标签核对', owner: '布展组组长' }
      ],
      materials: [
        { name: '展板', spec: '1.2m×2.4m 可拼接', unit: '块', price: 80, qty: function () { return 4; }, note: '按作品数量调整' },
        { name: '作品标签卡', spec: 'A6，含作者与作品说明', unit: '张', price: 1, qty: function (c) { return Math.ceil(c.scale * 0.5); }, note: '每件作品 1 张' },
        { name: '射灯', spec: '暖光，含夹子', unit: '个', price: 30, qty: function () { return 2; }, note: '重点展区补光' },
        { name: '投票贴纸', spec: '圆形，多色', unit: '张', price: 0.5, qty: function (c) { return c.scale; }, note: '每人 1 张' }
      ],
      weights: { material: 17, venue: 21, promo: 16, prize: 5, food: 6, transport: 6, insurance: 3, reserve: 8 },
      guestCount: 1,
      guestLabel: '指导老师与参展作者代表',
      prizeText: '人气作品奖 3 份，参展纪念证书按作品数准备',
      promoChannels: ['公众号发布展览预告与作品抢先看', '海报与展架放置在人流密集区', '班级群邀请同学组队观展', '作者转发作品卡片，设置现场投票话题'],
      risks: [
        { risk: '展品损坏或遗失', level: '高', trigger: '撤展清点时作品数量不符或出现破损', action: '立即封存现场监控并联系场地管理方，按作品登记表逐一核对，涉及赔偿由布展组对接作者', owner: '布展组组长' },
        { risk: '布展延期', level: '中', trigger: '开展前 2 小时展板或灯光仍未就位', action: '启用简化布展方案，优先保证作品与标签到位，灯光与装饰后补', owner: '布展组组长' },
        { risk: '观展秩序与用电安全', level: '中', trigger: '观众触碰展品或私接电源', action: '设置隔离带与提示牌，安排专人巡场，射灯线路由场地电工统一布置', owner: '安全保障组' }
      ],
      metrics: [
        { name: '观展人次', target: '≥ {visitTarget} 人次', method: '签到表与现场计数器统计' },
        { name: '参展作品数', target: '≥ {workTarget} 件', method: '作品登记表与撤展清点核对' }
      ],
      prep: {
        t7: ['完成作品征集与筛选，确定展陈方案'],
        t3: ['制作展板、标签与导览图，完成布展分工'],
        t1: ['现场试布展，测试灯光与用电负荷'],
        day: ['开展前 3 小时完成布展与安全检查']
      },
      noticePoints: ['观展时请勿触碰展品，拍照请关闭闪光灯', '现场投票每人 1 票，请将贴纸贴在作品标签处', '展览免费开放，欢迎携带同学一同观展'],
      venueNeeds: '展架或展板 4 组、长桌、射灯、电源、作品存放区',
      handbookNotes: ['作品登记表一式两份，布展与撤展各核对一次', '重点展区安排 1 名工作人员定点看护'],
      checkExtra: '活动前 3 天：完成作品登记与展陈方案确认，检查展板与灯光'
    },

    other: {
      label: '其他',
      themeWord: '同心同行',
      slogan: '一起把想法变成现场',
      visual: '主题色统一，信息层级清晰，重点信息用色块突出',
      background: '{org}计划举办「{name}」，希望通过一次结构完整的活动，把成员的想法转化为可执行的现场。活动将围绕「{theme}」设置开场、主体、互动和总结四个部分，并在筹备阶段明确分工、时间节点与安全责任。',
      purposes: [
        '围绕「{theme}」完成一次目标明确、流程完整的社团活动。',
        '通过明确分工与倒排工期，保证活动按计划落地。',
        '收集参与者反馈，形成可量化的活动效果记录。',
        '沉淀策划、执行与复盘文档，为同类活动提供参考。'
      ],
      flow: [
        { name: '签到入场', role: '现场执行组', weight: 12, content: '核验报名信息，发放活动资料，引导入座' },
        { name: '开场介绍', role: '主持人', weight: 10, content: '介绍活动背景、流程与注意事项' },
        { name: '主题活动', role: '策划组', weight: 36, content: '按方案开展主体环节，控制节奏并留出互动时间' },
        { name: '互动交流', role: '主持人', weight: 18, content: '组织提问、讨论或体验环节，收集参与者反馈' },
        { name: '总结分享', role: '总负责人', weight: 10, content: '总结活动亮点，说明后续安排与参与方式' },
        { name: '合影留念', role: '摄影记录组', weight: 8, content: '全体合影，留存活动素材' },
        { name: '散场清场', role: '后勤物资组', weight: 6, content: '引导离场，清点物资并完成场地清理' }
      ],
      extraRoles: [
        { role: '机动组', count: function () { return 2; }, duty: '临时支援、补位与突发情况处理', owner: '机动组组长' }
      ],
      materials: [
        { name: '指示牌', spec: 'A3 立牌，含动线指引', unit: '个', price: 20, qty: function () { return 2; }, note: '入口与签到区各 1 个' },
        { name: '备用电池', spec: '5 号与 7 号', unit: '节', price: 5, qty: function () { return 4; }, note: '话筒与翻页笔备用' },
        { name: '桌布', spec: '社团统一色', unit: '块', price: 15, qty: function () { return 2; }, note: '签到台与嘉宾席' }
      ],
      weights: { material: 14, venue: 19, promo: 12, prize: 7, food: 13, transport: 7, insurance: 3, reserve: 10 },
      guestCount: 0,
      guestLabel: '',
      prizeText: '互动纪念品按参与人数准备',
      promoChannels: ['公众号发布活动预告与报名入口', '班级群与会员群转发', '海报张贴于教学楼与食堂', '活动后发布图文回顾'],
      risks: [
        { risk: '流程衔接不畅', level: '中', trigger: '环节之间出现 5 分钟以上空档', action: '主持人启用备用串词或互动，执行组立即催场并确认下一环节准备情况', owner: '策划组' },
        { risk: '物资准备不足', level: '中', trigger: '签到或活动进行中发现关键物料短缺', action: '机动组就近采购或借用，财务组登记临时支出并保留票据', owner: '后勤物资组' }
      ],
      metrics: [
        { name: '报名到场率', target: '≥ 85%', method: '签到人数除以报名人数' },
        { name: '参与者满意度', target: '≥ 4.3 分（5 分制）', method: '活动后发放线上问卷' }
      ],
      prep: {
        t7: ['确认活动方案与场地，发布报名通知'],
        t3: ['统计报名人数，完成物资采购'],
        t1: ['现场走场，确认设备与人员分工'],
        day: ['提前 2 小时到场布置，活动后完成清场']
      },
      noticePoints: ['请提前 15 分钟签到入场', '活动期间请遵守现场秩序，听从工作人员安排'],
      venueNeeds: '投影、无线话筒 2 支、桌椅、电源',
      handbookNotes: ['各环节负责人提前 10 分钟到岗', '现场问题统一汇总到总负责人处决策'],
      checkExtra: '活动前 3 天：完成流程走场与物资清点'
    }
  };

  /* ============================================================
   * 二、通用工具（纯字符串/整数运算，不依赖 Date、Math.random）
   * ============================================================ */
  function str(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  function parseNumber(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = str(v).replace(/[,，\s]/g, '').replace(/[¥￥元]/g, '');
    if (!s) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function numOr(v, dflt) {
    var n = parseNumber(v);
    return n === null ? dflt : n;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function parseList(v) {
    if (Array.isArray(v)) {
      return v.map(str).filter(function (x) { return x !== ''; });
    }
    var s = str(v);
    if (!s) return [];
    return s.split(/[\n\r;；]+/).map(str).filter(function (x) { return x !== ''; });
  }

  // 正文里使用简称：去掉括号补充说明与「限 XX 人」之类的定语，完整描述只保留在信息表与通知里。
  function shortAudience(text) {
    var s = str(text);
    if (!s) return s;
    var short = s.replace(/[（(][^）)]*[）)]/g, '');
    short = short.replace(/[，,；;]\s*(限|仅限|名额|先到先得|报满即止).*$/, '');
    short = short.replace(/\s*[（(].*$/, '');
    short = short.trim().replace(/[，,、；;：:]+$/, '');
    return short || s;
  }

  function parseTime(v) {
    var m = /^(\d{1,2})\s*[:：]\s*(\d{2})$/.exec(str(v));
    if (!m) return null;
    var h = Number(m[1]);
    var mi = Number(m[2]);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return h * 60 + mi;
  }

  function fmtTime(minutes) {
    var m = clamp(Math.round(minutes), 0, 1439);
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  function daysInMonth(y, m) {
    if (m === 2) {
      return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : 28;
    }
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  function parseDate(v) {
    var m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(str(v));
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { y: y, m: mo, d: d, days: daysFromCivil(y, mo, d) };
  }

  function isoFrom(p) {
    return p.y + '-' + pad2(p.m) + '-' + pad2(p.d);
  }

  // Howard Hinnant 的民用历整数算法，用于无 Date 的日期加减。
  function daysFromCivil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400);
    var yoe = y - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }

  function civilFromDays(z) {
    z += 719468;
    var era = Math.floor(z / 146097);
    var doe = z - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var y = yoe + era * 400;
    var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    var mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    var m = mp + (mp < 10 ? 3 : -9);
    y += m <= 2 ? 1 : 0;
    return { y: y, m: m, d: d };
  }

  function addDaysISO(iso, n) {
    var p = parseDate(iso);
    if (!p) return '';
    return isoFrom(civilFromDays(p.days + n));
  }

  function weekdayLabel(iso) {
    var p = parseDate(iso);
    if (!p) return '';
    return '周' + WEEK.charAt(((p.days + 4) % 7 + 7) % 7);
  }

  function dateCN(iso) {
    var p = parseDate(iso);
    if (!p) return iso || '待定';
    return p.y + '年' + p.m + '月' + p.d + '日（' + weekdayLabel(iso) + '）';
  }

  function dateOnlyCN(iso) {
    var p = parseDate(iso);
    if (!p) return iso || '待定';
    return p.y + '年' + p.m + '月' + p.d + '日';
  }

  function tp(text, c) {
    return String(text).replace(/\{(\w+)\}/g, function (all, key) {
      return c[key] !== undefined && c[key] !== '' ? String(c[key]) : all;
    });
  }

  function detectType(raw) {
    for (var i = 0; i < TYPE_ALIASES.length; i++) {
      if (TYPE_ALIASES[i][1].test(raw)) return TYPE_ALIASES[i][0];
    }
    return 'other';
  }

  function moneyText(cents) {
    return (Math.round(cents) / 100).toFixed(2);
  }

  function pctText(amount, total) {
    if (!total) return '0.0%';
    return (amount / total * 100).toFixed(1) + '%';
  }

  function sumCents(items) {
    return items.reduce(function (a, b) { return a + b.costCents; }, 0);
  }

  // 最大余额法：把整数总额精确拆分到各权重项，合计严格相等。
  function allocateCents(total, weights) {
    var n = weights.length;
    var out = [];
    var i;
    if (!n) return out;
    if (total <= 0) {
      for (i = 0; i < n; i++) out.push(0);
      return out;
    }
    var sum = 0;
    for (i = 0; i < n; i++) sum += Math.max(0, weights[i]);
    if (!sum) {
      for (i = 0; i < n; i++) out.push(0);
      return out;
    }
    var raw = [];
    var used = 0;
    for (i = 0; i < n; i++) {
      var exact = total * Math.max(0, weights[i]) / sum;
      raw.push(exact);
      out.push(Math.floor(exact));
      used += Math.floor(exact);
    }
    var order = raw.map(function (v, idx) {
      return { idx: idx, frac: v - Math.floor(v) };
    }).sort(function (a, b) {
      if (b.frac !== a.frac) return b.frac - a.frac;
      return a.idx - b.idx;
    });
    var left = total - used;
    for (i = 0; i < left; i++) out[order[i % n].idx] += 1;
    return out;
  }

  /* ============================================================
   * 三、上下文推导：默认值、角色、物资、流程、预算
   * ============================================================ */
  function buildContext(input) {
    var src = input && typeof input === 'object' ? input : {};
    var name = str(src.name) || '社团主题活动';
    var typeKey = detectType(str(src.type));
    var cfg = TYPES[typeKey];

    var startMin = parseTime(str(src.timeStart));
    if (startMin === null) startMin = 19 * 60;
    var endMin = parseTime(str(src.timeEnd));
    if (endMin === null) endMin = 21 * 60;
    if (endMin <= startMin) endMin = Math.min(startMin + 120, 1439);
    if (endMin <= startMin) startMin = Math.max(0, endMin - 60);

    var dInfo = parseDate(str(src.date));
    var dateIso = dInfo ? isoFrom(dInfo) : '';
    var date = dateIso || str(src.date) || '待定';

    var deadline = str(src.registrationDeadline);
    if (!deadline) deadline = dateIso ? addDaysISO(dateIso, -3) + ' 23:59' : '待定';

    var scale = Math.round(numOr(src.scale, DEFAULT_SCALE));
    if (!isFinite(scale) || scale < 5) scale = DEFAULT_SCALE;
    scale = clamp(scale, 5, 3000);

    var guests = parseList(src.guests).reduce(function (acc, line) {
      // 嘉宾名单允许用顿号、逗号分隔（「李老师、王社长」），与亮点等自由文本区分开
      return acc.concat(line.split(/[、,，；;]+/).map(str).filter(function (x) { return x !== ''; }));
    }, []);
    var guestCount = guests.length || cfg.guestCount || 0;
    if (!guests.length && cfg.guestLabel) guests.push(cfg.guestLabel);

    var feeRaw = parseNumber(src.fee);
    var fee = '';
    if (typeof src.fee === 'string' && str(src.fee)) {
      fee = str(src.fee);
    } else if (feeRaw !== null) {
      fee = feeRaw > 0 ? feeRaw + ' 元/人' : '免费';
    } else {
      fee = '免费';
    }

    var needVenue = !(src.needVenue === false || /^(否|不需要|no|false)$/i.test(str(src.needVenue)));
    var audienceRaw = str(src.audience) || '全校学生';

    var c = {
      input: src,
      name: name,
      typeKey: typeKey,
      cfg: cfg,
      typeLabel: cfg.label,
      theme: str(src.theme) || (name + '·' + cfg.themeWord),
      slogan: cfg.slogan,
      org: str(src.org) || '学生社团',
      coOrg: str(src.coOrg) || '无',
      date: date,
      dateIso: dateIso,
      dateCN: dateCN(dateIso || date),
      prepDateCN: dateCN(dateIso || date),
      timeStart: fmtTime(startMin),
      timeEnd: fmtTime(endMin),
      startMin: startMin,
      endMin: endMin,
      totalMin: endMin - startMin,
      place: str(src.place) || '待定',
      scale: scale,
      audience: audienceRaw,
      audienceShort: shortAudience(audienceRaw),
      contactName: str(src.contactName) || '社团负责人',
      contactPhone: str(src.contactPhone) || '待定',
      budgetInput: parseNumber(src.budget),
      fee: fee,
      registrationDeadline: deadline,
      needVenue: needVenue,
      venueNeeds: str(src.venueNeeds) || cfg.venueNeeds,
      guests: guests,
      guestCount: guestCount,
      guestLabel: str(src.guests) || cfg.guestLabel || '无',
      purpose: str(src.purpose),
      background: str(src.background),
      highlights: parseList(src.highlights),
      customMaterials: parseList(src.materials),
      prizeText: str(src.prizes) || cfg.prizeText,
      readTarget: Math.max(200, Math.round(scale * 5 / 10) * 10),
      teamTarget: Math.max(4, Math.round(scale * 0.3)),
      serviceHours: Math.max(8, Math.round(scale * 2)),
      workTarget: Math.max(10, Math.round(scale * 0.4)),
      visitTarget: Math.max(100, scale * 2)
    };

    if (!c.highlights.length) {
      c.highlights = [
        '流程紧凑：签到、主体、互动、合影四个节点均设专人负责，主持人按分钟控场',
        '参与感强：设置现场互动与反馈环节，让参与者不只是旁观',
        '可留存：签到数据、活动照片与问卷结果统一归档，活动后 3 天内产出图文回顾',
        '有兜底：设备、天气、人员与经费均有对应预案，关键岗位双人备份'
      ];
    }

    c.typeWord = typeKey === 'other' ? '主题' : cfg.label;
    c.activityWord = c.typeWord;
    c.planTitle = '「' + name + '」' + (/活动$/.test(name) ? '' : '活动') + '策划书';
    c.noticeTitle = '关于举办' + (/活动$/.test(name) ? '「' + name + '」' : '「' + name + '」活动') + '的通知';
    c.guestPhrase = c.guestCount > 0 && c.guestLabel ? '及' + c.guestLabel : '';

    c.purposes = cfg.purposes.map(function (x) { return tp(x, c); });
    c.backgroundText = c.background ? tp(c.background, c) : tp(cfg.background, c);

    c.roles = buildRoles(c);
    c.totalPeople = c.scale + c.staffTotal + c.guestCount;
    var materialNeeds = buildMaterials(c, Infinity);
    var materialNeedCents = sumCents(materialNeeds);
    c.budgetPlan = planBudget(c, materialNeedCents);
    c.materialBudgetCents = c.budgetPlan.amounts.material;
    c.materials = materialNeedCents <= c.materialBudgetCents ? materialNeeds : buildMaterials(c, c.materialBudgetCents);
    c.materialTotal = sumCents(c.materials);
    c.flow = buildFlow(c);
    c.budget = buildBudget(c);

    return c;
  }

  function buildRoles(c) {
    var s = c.scale;
    var roles = [
      { role: '总负责人', count: 1, duty: '统筹全局、对外联络、现场决策与突发情况处置', owner: c.contactName },
      { role: '策划组', count: 2, duty: '流程设计、文案撰写、进度跟踪与复盘记录', owner: '策划组组长' },
      { role: '宣传组', count: clamp(Math.ceil(s / 60) + 1, 2, 5), duty: '海报推文、渠道投放、报名答疑与数据统计', owner: '宣传组组长' },
      { role: '后勤物资组', count: clamp(Math.ceil(s / 50) + 1, 2, 5), duty: '物资采购、场地布置、餐饮补给与归还', owner: '后勤组组长' },
      { role: '现场执行组', count: clamp(Math.ceil(s / 25) + 2, 3, 10), duty: '签到、引导、秩序维护与流程催场', owner: '执行组组长' },
      { role: '财务组', count: 1, duty: '预算编制、票据收集、决算与报销', owner: '财务负责人' },
      { role: '摄影记录组', count: s >= 80 ? 2 : 1, duty: '照片视频拍摄、素材归档与新闻稿配图', owner: '摄影组组长' },
      { role: '安全保障组', count: clamp(Math.ceil(s / 80), 1, 4), duty: '安全巡查、应急联络、散场疏导与保险名单', owner: '安全组组长' }
    ];
    c.cfg.extraRoles.forEach(function (r) {
      roles.push({ role: r.role, count: r.count(c), duty: r.duty, owner: r.owner });
    });
    c.staffTotal = roles.reduce(function (sum, r) { return sum + r.count; }, 0);
    return roles;
  }

  function estimateBudgetCents(c) {
    var base = 30000 + c.scale * 1800 + c.guestCount * 40000;
    if (c.typeKey === 'performance') base += 30000;
    if (c.typeKey === 'competition') base += 20000;
    return Math.ceil(base / 10000) * 10000;
  }


  // 从奖品描述里估算奖品预算（如「最佳分享人 3 名：图书礼包（每人 80 元）」→ 240 元）。
  function prizeNeedCents(c) {
    var text = str(c.prizeText);
    if (!text) return 0;
    var total = 0;
    var re = /(\d+)\s*(?:名|人|位|个)[^0-9]{0,14}?(\d+)\s*元/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      total += Number(m[1]) * Number(m[2]);
    }
    if (!total) {
      var one = /(\d+)\s*元/.exec(text);
      if (one) total = Number(one[1]);
    }
    if (!total) total = 100;
    // 文本里的金额单位是「元」，预算统一用「分」
    return Math.min(Math.round(total * 100), 100000);
  }

  function planBudget(c, materialNeedCents) {
    var estimate = estimateBudgetCents(c);
    var total;
    var note = '';
    var isReference = false;
    if (c.budgetInput !== null && c.budgetInput > 0) {
      total = Math.round(c.budgetInput * 100);
      if (total < estimate) {
        note = '所填预算低于同类活动参考测算 ' + moneyText(estimate) + ' 元，已按该预算压缩物资与弹性支出，建议优先保障场地、安全与签到物资。';
      }
    } else {
      total = estimate;
      isReference = true;
      note = '未填写预算，按 ' + c.scale + ' 人规模给出参考测算（参考价、待审批），最终以指导老师审批金额为准。';
    }
    // 分配顺序：先保「奖品」（奖项文本里写明的钱）、「场地」（申请了场地就要付租金），
    // 再保物资的真实需求，剩余部分按活动类型权重分给宣传、餐饮、保险与应急。
    // 全程用整数「分」，最后由物资吸收取整误差，保证分项合计严格等于总额。
    var need = Math.max(0, Math.round(materialNeedCents || 0));
    var prizeFloor = Math.min(prizeNeedCents(c), Math.floor(total * 0.4));
    var venueFloor = c.needVenue ? Math.min(20000, Math.floor(total * 0.35)) : 0;
    var minOthers = Math.round(total * 0.10);
    var matFloor = Math.min(need, Math.max(0, total - prizeFloor - venueFloor - minOthers));

    var floors = {};
    floors.material = matFloor;
    floors.prize = prizeFloor;
    floors.venue = venueFloor;
    var floorSum = matFloor + prizeFloor + venueFloor;
    if (floorSum > total) {
      var excess = floorSum - total;
      matFloor = Math.max(0, matFloor - excess);
      floors.material = matFloor;
      floorSum = matFloor + prizeFloor + venueFloor;
    }
    var remaining = total - floorSum;
    var otherWeights = CATEGORY_DEFS.filter(function (d) { return d.key !== 'material'; }).map(function (d) {
      var w = c.cfg.weights[d.key];
      return typeof w === 'number' ? w : 0;
    });
    var extra = allocateCents(remaining, otherWeights);
    var amounts = { material: matFloor };
    CATEGORY_DEFS.filter(function (d) { return d.key !== 'material'; }).forEach(function (d, i) {
      amounts[d.key] = (floors[d.key] || 0) + extra[i];
    });
    var checkSum = CATEGORY_DEFS.reduce(function (a, d) { return a + (amounts[d.key] || 0); }, 0);
    amounts.material += total - checkSum; // 吸收取整误差

    return {
      totalCents: total,
      estimateCents: estimate,
      amounts: amounts,
      materialNeedCents: need,
      note: note,
      isReference: isReference
    };
  }

  function buildMaterials(c, capCents) {
    var items = [];
    var limit = capCents === undefined || capCents === null ? (c.materialBudgetCents || 0) : capCents;
    if (!isFinite(limit)) limit = Number.MAX_SAFE_INTEGER;
    var cap = Math.max(0, Math.floor(limit));
    var remaining = cap;

    function add(name, spec, unit, priceYuan, desiredQty, note) {
      var priceCents = Math.round(priceYuan * 100);
      var qty = Math.max(0, Math.round(desiredQty));
      if (!qty) return;
      if (priceCents <= 0) {
        items.push({
          name: name, spec: spec, unit: unit, qty: qty,
          priceCents: 0, costCents: 0, note: note || ''
        });
        return;
      }
      if (priceCents * qty > remaining) qty = Math.floor(remaining / priceCents);
      if (qty <= 0) return;
      var cost = priceCents * qty;
      items.push({
        name: name,
        spec: spec,
        unit: unit,
        qty: qty,
        priceCents: priceCents,
        costCents: cost,
        note: note || ''
      });
      remaining -= cost;
    }

    // 按优先级配置：先保签到与饮水，再按「物资物料」预算决定横幅、海报与耗材数量。
    add('签到表', 'A4 双面打印，按 20 人/页', '张', 0.2, Math.ceil(c.scale / 20) + 1, '按签到通道分册，提前打印');
    add('签字笔', '黑色 0.5mm', '支', 2, 4 + Math.ceil(c.scale / 40), '签到台与工作人员使用');
    add('主横幅', '3m×0.8m，含设计与安装', '米', 30, 3, '预算允许时优先制作，活动后回收');
    add('矿泉水', '550ml，整箱采购', '瓶', 1.5, c.scale + c.staffTotal, '按 1 瓶/人配置，鼓励自带水杯');
    add('宣传海报', 'A2 彩色，覆膜', '张', 20, 2 + Math.ceil(c.scale / 120), '教学楼、食堂与活动场地各点位');
    add('桌牌', '200g 铜版纸对折', '个', 5, 4 + Math.min(4, c.guestCount), '嘉宾席与评委席');
    add('工作证', '含挂绳与内页', '个', 1.5, c.staffTotal, '工作人员全程佩戴');
    add('胶带', '48mm 透明胶带', '卷', 8, 2, '布置与临时修补');
    add('插线板', '3m 线长、6 位', '个', 25, 2, '签到台与设备区各 1 个');
    add('垃圾袋', '大号加厚', '包', 5, 2, '活动结束后场地清理');
    add('抽纸', '软抽 3 层', '包', 6, 2, '签到台与嘉宾席');

    c.cfg.materials.forEach(function (m) {
      add(m.name, m.spec, m.unit, m.price, m.qty(c), m.note);
    });

    c.customMaterials.forEach(function (m) {
      add(m, '按活动方案自备', '项', 0, 1, '自备物资，不计入采购');
    });

    return items;
  }

  // 流程时间按 5 分钟整数倍排定：开始时间向上取整、结束时间向下取整，
  // 每个环节至少 5 分钟，各环节时长与起止时间都落在 5 分钟刻度上。
  function buildFlow(c) {
    var UNIT = 5;
    var segs = c.cfg.flow;
    var start = Math.ceil(c.startMin / UNIT) * UNIT;
    var end = Math.floor(c.endMin / UNIT) * UNIT;
    if (end - start < segs.length * UNIT) {
      end = start + segs.length * UNIT;
    }
    var units = Math.floor((end - start) / UNIT);
    if (units < segs.length) units = segs.length;
    var weights = segs.map(function (s) { return s.weight; });
    var alloc = allocateCents(units, weights);
    // 保证每个环节至少 1 个刻度（5 分钟），从最长环节匀出
    for (var guard = 0; guard < 500; guard++) {
      var zeroIdx = -1;
      var maxIdx = 0;
      for (var i = 0; i < alloc.length; i++) {
        if (alloc[i] < 1 && zeroIdx < 0) zeroIdx = i;
        if (alloc[i] > alloc[maxIdx]) maxIdx = i;
      }
      if (zeroIdx < 0 || alloc[maxIdx] <= 1) break;
      alloc[maxIdx] -= 1;
      alloc[zeroIdx] += 1;
    }
    var t = start;
    return segs.map(function (seg, i) {
      var segStart = t;
      var segEnd = t + alloc[i] * UNIT;
      t = segEnd;
      return {
        startMin: segStart,
        endMin: segEnd,
        time: fmtTime(segStart) + '—' + fmtTime(segEnd),
        name: seg.name,
        content: seg.content,
        owner: seg.role,
        minutes: segEnd - segStart
      };
    });
  }

  /* ---------- 预算分项 ---------- */
  function budgetCandidates(c, key) {
    var s = c.scale;
    var staff = c.staffTotal;
    var g = c.guestCount;
    switch (key) {
      case 'venue':
        var venueList = [
          { name: '场地租用', spec: '校内场地，按 200 元/次计', price: 200, qty: 1 },
          { name: '音响与话筒', spec: '无线话筒 2 支、调音台', price: 150, qty: s >= 40 ? 1 : 0 },
          { name: '投影或 LED 屏', spec: '按场次租用', price: 300, qty: s >= 80 ? 1 : 0 },
          { name: '桌椅搬运与布置', spec: '含 20 套桌椅', price: 100, qty: s >= 30 ? 1 : 0 },
          { name: '场地布置与背景板', spec: '含桁架、喷绘与安装', price: 300, qty: s >= 100 ? 1 : 0 },
          { name: '舞台或大屏增项', spec: '按场次租赁', price: 500, qty: s >= 150 ? 1 : 0 }
        ];
        if (g) {
          venueList.splice(1, 0,
            { name: '嘉宾课酬', spec: '按 1 场计算，含备课与现场', price: guestFee(c), qty: g },
            { name: '嘉宾交通与接待', spec: '往返交通、工作餐与答谢', price: 100, qty: g }
          );
        }
        return venueList;
      case 'promo':
        return [
          { name: '视觉设计费', spec: '主视觉、海报与推文排版', price: 100, qty: 1 },
          { name: '短视频拍摄与剪辑', spec: '1 条 30 秒花絮', price: 200, qty: s >= 60 ? 1 : 0 },
          { name: '线上推广与互动奖品', spec: '转发抽奖与话题激励', price: 50, qty: Math.max(2, Math.ceil(s / 80)) },
          { name: '印刷加急费', spec: '海报与单页加急', price: 50, qty: 1 }
        ];
      case 'prize':
        return prizeCandidates(c);
      case 'food':
        return [
          { name: '茶歇点心', spec: '按 8 元/份，含饮品', price: 8, qty: Math.ceil(s * 0.6) },
          { name: '工作人员工作餐', spec: '按 15 元/份', price: 15, qty: staff },
          { name: '餐饮配送与餐具', spec: '一次性餐具与配送', price: 20, qty: 1 }
        ];
      case 'transport':
        return [
          { name: '物资运输', spec: '校内货运或网约车 1 次', price: 100, qty: 1 },
          { name: '工作人员交通补贴', spec: '按 10 元/人', price: 10, qty: staff },
          { name: '嘉宾接送', spec: '按 50 元/人', price: 50, qty: g }
        ];
      case 'insurance':
        return [
          { name: '活动保险', spec: '按 5 元/人投保', price: 5, qty: s },
          { name: '急救包与药品', spec: '含创可贴、碘伏、藿香正气水', price: 80, qty: 1 },
          { name: '安全围挡与指示', spec: '隔离带、地贴与指示牌', price: 50, qty: 2 }
        ];
      case 'reserve':
        return [
          { name: '一次性雨衣', spec: '按 3 元/件，户外环节备用', price: 3, qty: Math.min(s, 60) },
          { name: '备用电源与耗材', spec: '充电宝、电池、转换头', price: 50, qty: 1 },
          { name: '应急药品', spec: '防暑、防过敏药品', price: 50, qty: 1 }
        ];
      default:
        return [];
    }
  }

  function guestFee(c) {
    if (c.typeKey === 'lecture' || c.typeKey === 'training') return 300;
    return 200;
  }

  function prizeCandidates(c) {
    var s = c.scale;
    var list;
    switch (c.typeKey) {
      case 'competition':
        list = [
          { name: '一等奖奖品', spec: '按 1 名设置', price: 150, qty: 1 },
          { name: '二等奖奖品', spec: '按 2 名设置', price: 80, qty: 2 },
          { name: '三等奖奖品', spec: '按 3 名设置', price: 30, qty: 3 },
          { name: '奖杯与奖牌', spec: '含刻字', price: 80, qty: 3 },
          { name: '获奖证书', spec: 'A4 铜版纸', price: 3, qty: 6 }
        ];
        break;
      case 'performance':
        list = [
          { name: '现场抽奖礼品', spec: '按 10 份准备', price: 30, qty: 5 },
          { name: '优秀节目证书', spec: 'A4 铜版纸', price: 3, qty: 3 },
          { name: '演出纪念品', spec: '钥匙扣、明信片', price: 10, qty: Math.ceil(s * 0.3) }
        ];
        break;
      case 'volunteer':
        list = [
          { name: '优秀志愿者证书', spec: 'A4 铜版纸', price: 3, qty: Math.ceil(s * 0.2) },
          { name: '纪念徽章', spec: '金属徽章', price: 5, qty: s }
        ];
        break;
      case 'team':
        list = [
          { name: '团队优胜奖品', spec: '按 3 组设置', price: 50, qty: 3 },
          { name: '参与纪念品', spec: '定制徽章或手环', price: 8, qty: s }
        ];
        break;
      case 'recruit':
        list = [{ name: '咨询小礼品', spec: '贴纸、书签', price: 3, qty: s }];
        break;
      case 'training':
        list = [{ name: '优秀学员奖品', spec: '按 3 名设置', price: 30, qty: 3 }];
        break;
      case 'exhibition':
        list = [
          { name: '人气作品奖', spec: '按 3 名设置', price: 50, qty: 3 },
          { name: '参展纪念证书', spec: 'A4 铜版纸', price: 3, qty: Math.ceil(s * 0.5) }
        ];
        break;
      case 'lecture':
        list = [
          { name: '互动纪念品', spec: '笔记本、书签', price: 10, qty: 5 },
          { name: '抽奖礼品', spec: '书籍或文创', price: 20, qty: 3 }
        ];
        break;
      default:
        list = [
          { name: '参与纪念品', spec: '定制小礼品', price: 8, qty: Math.ceil(s * 0.5) },
          { name: '互动抽奖礼品', spec: '按 3 份准备', price: 20, qty: 3 }
        ];
    }
    return list;
  }

  function residualName(key) {
    var map = {
      venue: '场地、设备与嘉宾费用增补（据实结算）',
      promo: '宣传加投（二次推送与线上活动）',
      prize: '奖项升级与奖品加购',
      food: '餐饮加购与配送',
      transport: '交通应急与临时用车',
      insurance: '安全物资增补',
      reserve: '不可预见费（据实列支）'
    };
    return map[key] || '其他支出（据实结算）';
  }

  // 把某一分项的金额精确拆成若干「单价 × 数量」明细，余数落到该分项的机动行。
  function buildDetailLines(c, key, label, amount) {
    var rows = [];
    var remaining = amount;
    var candidates = budgetCandidates(c, key);
    candidates.forEach(function (cand) {
      var qty = Math.max(0, Math.round(cand.qty || 0));
      var price = Math.round(cand.price * 100);
      if (!qty || price <= 0) return;
      var cost = price * qty;
      if (cost > remaining) {
        qty = Math.floor(remaining / price);
        cost = price * qty;
      }
      if (qty <= 0) return;
      rows.push({
        cat: label,
        name: cand.name,
        spec: cand.spec,
        priceCents: price,
        qty: qty,
        costCents: cost
      });
      remaining -= cost;
    });
    if (remaining > 0) {
      rows.push({
        cat: label,
        name: residualName(key),
        spec: '按实际支出结算，凭票据报销',
        priceCents: remaining,
        qty: 1,
        costCents: remaining
      });
    }
    return rows;
  }

  function buildBudget(c) {
    var matTotal = c.materialTotal;
    var scale = c.scale;
    var budgetCents;
    var note = '';

    if (c.budgetInput !== null && c.budgetInput > 0) {
      budgetCents = Math.round(c.budgetInput * 100);
      if (budgetCents < matTotal) {
        budgetCents = matTotal;
        note = '所填预算低于物资清单合计 ' + moneyText(matTotal) + ' 元，已按物资成本下限测算，建议同步压缩规模或追加预算。';
      }
    } else {
      var estimate = matTotal + 20000 + 15000 + 20000 + scale * 300 + scale * 200 + 30000;
      budgetCents = Math.ceil(estimate / 10000) * 10000;
      note = '未填写预算，按 ' + scale + ' 人规模给出参考测算，最终以指导老师审批金额为准。';
    }

    var materialRows = c.materials.map(function (m) {
      return {
        cat: '物资物料',
        name: m.name,
        spec: m.spec + (m.note ? '；' + m.note : ''),
        priceCents: m.priceCents,
        qty: m.qty,
        costCents: m.costCents
      };
    });

    var summary = [];
    var detail = [];
    if (matTotal > 0) {
      summary.push({ key: 'material', label: '物资物料', amount: matTotal, use: '横幅海报、签到物料、现场耗材与自备物资' });
      detail = detail.concat(materialRows);
    }

    var otherDefs = CATEGORY_DEFS.filter(function (d) { return d.key !== 'material'; });
    var weights = otherDefs.map(function (d) {
      // 以 planBudget 给出的分项额度作为权重，确保「奖品」「场地」等下限不会被平均掉。
      var planned = c.budgetPlan.amounts ? c.budgetPlan.amounts[d.key] : 0;
      if (typeof planned === 'number' && planned > 0) return planned;
      var w = c.cfg.weights[d.key];
      return typeof w === 'number' ? w : 0;
    });
    var amounts = allocateCents(budgetCents - matTotal, weights);
    otherDefs.forEach(function (d, i) {
      var amount = amounts[i];
      if (amount <= 0) return;
      var use = d.key === 'prize' && c.prizeText ? '奖项设置：' + c.prizeText : d.use;
      summary.push({ key: d.key, label: d.label, amount: amount, use: use });
      detail = detail.concat(buildDetailLines(c, d.key, d.label, amount));
    });

    if (matTotal * 2 > budgetCents) {
      note = (note ? note + ' ' : '') + '预算中物资占比偏高，弹性支出空间有限，建议优先保障场地、宣传与安全支出，或适当压缩物资数量。';
    }

    return {
      totalCents: budgetCents,
      materialTotal: matTotal,
      summary: summary,
      detail: detail,
      note: note
    };
  }

  /* ============================================================
   * 四、DocSpec 构建
   * ============================================================ */
  function h1(text) { return { type: 'h1', text: text }; }
  function h2(text) { return { type: 'h2', text: text }; }
  function h3(text) { return { type: 'h3', text: text }; }
  function p(text, align) {
    var b = { type: 'p', text: text };
    if (align) b.align = align;
    return b;
  }
  function bullets(items) { return { type: 'bullets', items: items }; }
  function numbers(items) { return { type: 'numbers', items: items }; }
  function quote(text) { return { type: 'quote', text: text }; }
  function note(text) { return { type: 'note', text: text }; }
  function kv(rows) { return { type: 'kv', rows: rows }; }
  function table(headers, rows, widths) {
    return {
      type: 'table',
      headers: headers.slice(),
      rows: rows.map(function (row) {
        return row.map(function (cell) { return String(cell); });
      }),
      widths: widths.slice()
    };
  }

  function joinTasks(arr) {
    return arr.filter(function (x) { return str(x) !== ''; }).join('；');
  }

  function prepRows(c) {
    var common = {
      t14: ['确定活动方案、主题与预算，报指导老师审批', '提交场地使用申请表，确认场地与设备', '成立筹备组，明确各组负责人'],
      t10: ['完成主视觉、海报与推文初稿', '发布活动预告，建立报名咨询群'],
      t7: ['发布正式通知与报名表，开启报名', '确认嘉宾、评委或演出人员档期', '完成主要物资询价与采购'],
      t3: ['统计报名人数，按实际人数调整物资数量', '完成第二轮宣传与班级群定向转发', '完成流程走场与设备联调'],
      t1: ['打印签到表、流程单、桌牌与证书', '完成场地布置与安全隐患排查', '召开行前会，明确分工与应急流程', '准备备用金、急救包与雨具'],
      day: ['提前 2 小时到场，完成签到台与场地布置', '提前 30 分钟完成设备、物料与引导就位', '活动结束后 1 小时内完成清场与物资清点']
    };
    var stages = [
      { phase: 'T-14', offset: -14, tasks: common.t14, owner: '总负责人、策划组', deliver: '策划书、预算表、场地申请回执' },
      { phase: 'T-10', offset: -10, tasks: common.t10, owner: '宣传组', deliver: '主视觉、预告推文、报名咨询群' },
      { phase: 'T-7', offset: -7, tasks: common.t7, owner: '策划组、宣传组', deliver: '正式通知、报名表、嘉宾确认单' },
      { phase: 'T-3', offset: -3, tasks: common.t3, owner: '策划组、后勤物资组', deliver: '报名统计表、采购清单、走场记录' },
      { phase: 'T-1', offset: -1, tasks: common.t1, owner: '后勤物资组、安全保障组', deliver: '签到表、流程单、应急物资' },
      { phase: '当天', offset: 0, tasks: common.day, owner: '总负责人、现场执行组', deliver: '签到数据、现场照片、清场确认单' }
    ];
    var prepCfg = c.cfg.prep || {};
    stages.forEach(function (st) {
      var key = st.offset === -14 ? 't14' : st.offset === -10 ? 't10' : st.offset === -7 ? 't7' : st.offset === -3 ? 't3' : st.offset === -1 ? 't1' : 'day';
      st.tasks = st.tasks.concat(prepCfg[key] || []);
    });
    return stages.map(function (st) {
      var when;
      if (st.offset === 0) {
        when = c.dateCN;
      } else if (c.dateIso) {
        when = dateCN(addDaysISO(c.dateIso, st.offset));
      } else {
        when = '活动前 ' + Math.abs(st.offset) + ' 天';
      }
      return [st.phase, when, joinTasks(st.tasks), st.owner, st.deliver];
    });
  }

  function promoRows(c) {
    return [
      ['预热期', '活动前 10—8 天', '发布主视觉海报与预告推文，开放咨询群，收集选题与问题', '宣传组', '阅读量 ≥ ' + c.readTarget + ' 人次'],
      ['报名期', '活动前 7—4 天', '发布通知与报名表，班级群、会员群定向转发，每日答疑', '宣传组', '报名人数 ≥ ' + c.scale + ' 人'],
      ['冲刺期', '活动前 3—1 天', '倒计时海报、嘉宾或奖品揭晓、报名名单确认与提醒', '宣传组', '签到率 ≥ 85%'],
      ['现场期', '活动当天', '现场照片与短视频即时发布，引导参与者带话题转发', '摄影记录组', '话题互动 ≥ 50 条'],
      ['复盘期', '活动后 1—3 天', '发布新闻稿与图文回顾，公布数据与鸣谢名单', '宣传组', '阅读量 ≥ ' + (c.readTarget * 2) + ' 人次']
    ];
  }

  function staffStation(role) {
    if (/总负责人/.test(role)) return '全场机动，坐镇主控台';
    if (/策划/.test(role)) return '主控台与后台，负责催场';
    if (/宣传/.test(role)) return '签到台与媒体区';
    if (/后勤/.test(role)) return '物资区与后台';
    if (/执行/.test(role)) return '入口、通道与观众区';
    if (/财务/.test(role)) return '签到台，负责收费与票据';
    if (/摄影/.test(role)) return '观众区与舞台前';
    if (/安全/.test(role)) return '入口与疏散通道';
    return '按现场需要机动补位';
  }

  function suppliesFor(name) {
    if (/签到|入场|检票|布展|集合|摊位/.test(name)) return '签到表、签字笔、工作证、桌牌、二维码立牌';
    if (/开场|开幕|介绍|致辞|颁奖/.test(name)) return '话筒、流程单、计时器、提示牌';
    if (/互动|抽奖|问答|投票|破冰|咨询/.test(name)) return '话筒、抽奖箱、礼品、问卷二维码';
    if (/合影/.test(name)) return '相机、稳定器、队旗';
    if (/散场|撤场|清场|返程/.test(name)) return '垃圾袋、物资清点表、推车';
    return '投影、翻页笔、话筒、备用电脑';
  }

  function noticePointsFor(c) {
    return c.cfg.noticePoints && c.cfg.noticePoints.length ? c.cfg.noticePoints : ['请提前 15 分钟签到入场', '活动期间请遵守现场秩序，听从工作人员安排'];
  }

  function commonRisks() {
    return [
      { risk: '报名人数不足', level: '中', trigger: '活动前 3 天报名人数低于预计规模的 60%', action: '宣传组当晚追加班级群定向推送，开放候补报名，必要时下调物资数量并合并座位区', owner: '宣传组组长' },
      { risk: '人数超出场地容量', level: '高', trigger: '报名人数超过场地核定容量的 90%', action: '立即关闭报名通道并启用候补名单，加设分会场或线上直播，现场按批次限流', owner: '总负责人' },
      { risk: '设备故障', level: '中', trigger: '活动开始前 30 分钟投影、音响或话筒无法正常使用', action: '启用备用笔记本与蓝牙音箱，联系场地管理员调换设备，主持人准备无设备互动方案', owner: '后勤物资组' },
      { risk: '现场秩序混乱', level: '中', trigger: '入场或散场时出现拥挤、插队', action: '增开签到通道，设置单向动线与隔离带，安全组定点引导，必要时分批放行', owner: '安全保障组' },
      { risk: '人员受伤或身体不适', level: '高', trigger: '参与者出现跌倒、晕厥、过敏等情况', action: '就近取用急救包，安全组陪护至校医院并第一时间联系 120，同步通知家长与指导老师', owner: '安全保障组' },
      { risk: '活动超时', level: '中', trigger: '任一环节超出计划时长 10 分钟以上', action: '计时员举牌提醒，主持人压缩互动并合并合影环节，确保按预定时间散场', owner: '策划组' },
      { risk: '天气突变', level: '中', trigger: '户外环节开始前 2 小时发布降雨或大风预警', action: '启用室内备用场地或调整动线，提前通知参与者携带雨具，物资组准备一次性雨衣', owner: '总负责人' },
      { risk: '经费超支', level: '中', trigger: '临时采购导致单项支出超过预算 20%', action: '先使用应急备用金，超过 500 元需总负责人与指导老师双签，活动后 3 天内补齐票据', owner: '财务组' }
    ];
  }

  function commonMetrics(c) {
    return [
      { name: '报名到场率', target: '≥ 85%', method: '实际签到人数 ÷ 报名人数，签到表统计', owner: '现场执行组' },
      { name: '参与者满意度', target: '≥ 4.5 分（5 分制）', method: '活动结束后 24 小时内发放线上问卷，回收率 ≥ 60%', owner: '策划组' },
      { name: '传播触达', target: '≥ ' + c.readTarget + ' 人次', method: '公众号后台阅读量、转发截图与话题互动量', owner: '宣传组' },
      { name: '预算执行率', target: '≤ 105%', method: '财务组凭票据决算，与预算逐项对比', owner: '财务组' },
      { name: '安全事件', target: '0 起', method: '现场安全巡查记录与应急事件台账', owner: '安全保障组' }
    ];
  }

  function budgetSummaryTable(c) {
    var total = c.budget.totalCents;
    var pcts = c.budget.summary.map(function (s) {
      return Math.round((s.amount / total) * 1000) / 10;
    });
    var sum = pcts.reduce(function (a, b) { return a + b; }, 0);
    var diff = Math.round((100 - sum) * 10) / 10;
    if (c.budget.summary.length && diff !== 0) {
      var maxIdx = 0;
      for (var i = 1; i < c.budget.summary.length; i++) {
        if (c.budget.summary[i].amount > c.budget.summary[maxIdx].amount) maxIdx = i;
      }
      pcts[maxIdx] = Math.round((pcts[maxIdx] + diff) * 10) / 10;
    }
    var rows = c.budget.summary.map(function (s, i) {
      return [String(i + 1), s.label, moneyText(s.amount), pcts[i].toFixed(1) + '%', s.use];
    });
    rows.push(['—', '合计', moneyText(total), '100.0%', '预算总额，实际支出以票据为准']);
    return table(
      ['序号', '费用类别', '预算金额（元）', '占比', '主要用途'],
      rows,
      [600, 1600, 1600, 900, 4300]
    );
  }

  function budgetDetailTable(c) {
    var rows = c.budget.detail.map(function (d, i) {
      return [String(i + 1), d.cat, d.name, d.spec, moneyText(d.priceCents), String(d.qty), moneyText(d.costCents)];
    });
    rows.push(['—', '合计', '—', '—', '—', '—', moneyText(c.budget.totalCents)]);
    return table(
      ['序号', '类别', '项目', '测算说明', '单价（元）', '数量', '小计（元）'],
      rows,
      [500, 1200, 1800, 2600, 1100, 700, 1100]
    );
  }

  function buildPlanDoc(c) {
    var blocks = [];
    var meta = [
      ['主办单位', c.org],
      ['承办单位', c.coOrg],
      ['活动时间', c.dateCN + ' ' + c.timeStart + '—' + c.timeEnd],
      ['活动地点', c.place],
      ['活动对象', c.audience],
      ['预计规模', c.scale + ' 人'],
      ['联系人', c.contactName + '（' + c.contactPhone + '）']
    ];

    // 一、活动背景（只使用用户填写的内容，留空不自动生成）
    blocks.push(h1('一、活动背景'));
    if (c.background) {
      blocks.push(p(c.background));
    } else {
      blocks.push(note('（本节未填写活动背景，可在导出后补充。）'));
    }

    // 二、目的与意义（只使用用户填写的内容，留空不自动生成）
    blocks.push(h1('二、活动目的与意义'));
    if (c.purpose) {
      blocks.push(p(c.purpose));
    } else {
      blocks.push(note('（本节未填写活动目的与意义，可在导出后补充。）'));
    }

    // 三、主题与口号
    blocks.push(h1('三、活动主题与口号'));
    blocks.push(kv([
      ['活动主题', c.theme],
      ['宣传口号', c.slogan],
      ['视觉基调', c.cfg.visual],
      ['传播关键词', '#' + c.cfg.themeWord + ' #' + c.typeLabel + ' #' + c.org]
    ]));
    blocks.push(p('主题「' + c.theme + '」包含两层含义：一是回应' + c.audienceShort + '当下的真实需求，二是给活动一个统一的表达口径。所有海报、推文、主持词与现场物料都围绕这一主题展开，避免同一活动出现多个说法。'));
    blocks.push(p('口号「' + c.slogan + '」用于海报主视觉与推文首图，简洁、可复述，便于参与者在社交平台转发时直接引用。'));
    blocks.push(quote(c.slogan));
    blocks.push(h2('活动亮点'));
    blocks.push(bullets(c.highlights));

    // 四、对象与规模
    blocks.push(h1('四、活动对象与规模'));
    blocks.push(kv([
      ['参与对象', c.audience],
      ['预计规模', c.scale + ' 人'],
      ['工作人员', c.staffTotal + ' 人'],
      ['嘉宾与评委', c.guestLabel],
      ['报名方式', '线上报名表为主，现场报名视场地与名额开放'],
      ['名单确认', c.registrationDeadline]
    ]));
    blocks.push(p('人员构成按「参与者 ' + c.scale + ' 人 + 工作人员 ' + c.staffTotal + ' 人 + 嘉宾 ' + c.guestCount + ' 人」测算，场地需至少容纳 ' + (c.scale + c.staffTotal + c.guestCount) + ' 人，并预留通道、设备区与签到区。'));
    blocks.push(bullets([
      '报名上限：按场地核定容量的 85% 设置报名上限，超出后进入候补名单，按退出顺序依次递补。',
      '名额分配：' + c.audienceShort + '均可报名，社团会员与共建班级优先 1 天开放报名。',
      '确认机制：报名截止后 24 小时内完成名单核对，通过短信或群公告确认，未确认者视为放弃。'
    ]));

    // 五、时间与地点
    blocks.push(h1('五、活动时间与地点'));
    blocks.push(kv([
      ['活动日期', c.dateCN],
      ['活动时间', c.timeStart + '—' + c.timeEnd + '（共 ' + c.totalMin + ' 分钟）'],
      ['活动地点', c.place],
      ['场地需求', c.venueNeeds],
      ['布展与彩排', c.dateCN + ' ' + c.timeStart + ' 前 2 小时到场'],
      ['场地手续', c.needVenue ? '需提交场地使用申请表，提前 7 个工作日办理' : '使用社团自有或已借用场地，无需单独申请']
    ]));
    blocks.push(p('时间安排避开了主要课程时段，并预留 30 分钟机动时间用于设备调试和人员集合。' + (c.totalMin >= 120 ? '整体时长超过 2 小时，流程中设置 1 次短休息，避免参与者疲劳。' : '整体时长控制在 2 小时以内，环节紧凑，适合课间或晚自习前参与。')));
    blocks.push(p('地点选择上优先考虑交通便利、设备齐全、可容纳 ' + (c.scale + c.staffTotal + c.guestCount) + ' 人的场地。现场划分为签到区、主活动区、嘉宾区、设备区与疏散通道五个区域，每个区域由对应小组负责。'));

    // 六、组织架构
    blocks.push(h1('六、组织架构与人员分工'));
    blocks.push(p('活动成立筹备组，设总负责人 1 名，下设策划、宣传、后勤物资、现场执行、财务、摄影记录与安全保障等小组，工作人员合计 ' + c.staffTotal + ' 人。总负责人对活动整体负责，各组组长对本组任务与进度负责。'));
    blocks.push(table(
      ['角色', '人数', '主要职责', '负责人'],
      c.roles.map(function (r) { return [r.role, String(r.count), r.duty, r.owner]; }),
      [1800, 900, 4600, 1700]
    ));
    blocks.push(h2('工作机制'));
    blocks.push(bullets([
      '例会机制：活动前 7 天、前 1 天各召开 1 次筹备会，每次不超过 40 分钟，会后形成待办清单并明确完成时间。',
      '日报机制：活动前 7 天起，各组每天 21:00 前在筹备群同步进度与卡点，未完成事项由总负责人协调。',
      '文档机制：策划、预算、名单、物料与照片统一存放在共享文件夹，文件命名格式为「日期_内容_版本」。',
      '决策机制：现场问题由总负责人拍板；单笔超过 200 元的临时支出需与财务组、指导老师确认。'
    ]));
    if (c.staffTotal >= 10) {
      blocks.push(p('工作人员与志愿者由各组组长统一调度，活动当天实行「定人、定点、定任务」：每名工作人员在流程单上标注岗位、站位与替补人选，避免出现无人负责的区域。'));
    }

    // 七、活动流程
    blocks.push(h1('七、活动流程'));
    var flowSpan = c.flow.length ? (c.flow[c.flow.length - 1].endMin - c.flow[0].startMin) : c.totalMin;
    blocks.push(p('活动总时长 ' + flowSpan + ' 分钟（时间为 5 分钟整数倍），共 ' + c.flow.length + ' 个环节，各环节时长按活动类型与内容重点分配。时间以签到开始计算，主持人与计时员各持一份流程单。'));
    blocks.push(table(
      ['时间', '环节', '内容', '负责人', '时长（分钟）'],
      c.flow.map(function (f) { return [f.time, f.name, f.content, f.owner, String(f.minutes)]; }),
      [1600, 1800, 3400, 1200, 1000]
    ));
    blocks.push(note('流程时间为计划时间，现场由主持人根据实际进度微调，调整幅度超过 10 分钟须报总负责人确认。'));
    blocks.push(h2('奖励与激励'));
    blocks.push(p('本次活动设置：' + c.prizeText + '。具体奖项、评选方式与领取规则在活动前 3 天通过活动群公示，评选过程由' + (c.typeKey === 'competition' ? '评委组' : '策划组') + '负责，结果当场公布。'));
    blocks.push(h2('关键节点'));
    blocks.push(bullets([
      '签到开始前 30 分钟：签到台、物料与引导牌全部就位，工作人员完成对时。',
      '主体环节开始前 10 分钟：确认嘉宾、设备与座位，主持人收到最新流程单。',
      '结束前 15 分钟：摄影组就位，后勤组准备清场与物资回收。'
    ]));

    // 八、筹备进度
    blocks.push(h1('八、前期准备与筹备进度'));
    blocks.push(p('筹备工作按活动日倒排，以 T 表示活动当天，T-14 启动、T-1 收口。每个阶段设置交付物，未按时完成的事项在例会上说明原因并给出补救方案。'));
    blocks.push(table(
      ['阶段', '时间节点', '关键工作', '负责人', '交付物'],
      prepRows(c),
      [1000, 1600, 3600, 1400, 1400]
    ));
    blocks.push(p('筹备期间保持两次全流程检查：T-3 检查报名、物资与场地，T-1 检查流程、设备与人员。两次检查均使用清单逐项打勾，发现问题当天闭环。'));
    blocks.push(bullets([
      '关键物料至少提前 1 天到场，避免活动当天临时采购。',
      '场地、设备与嘉宾三项在 T-3 前完成最终确认，之后只做微调。',
      '报名数据在 T-1 固化，作为物资数量、座位与签到表的最终依据。'
    ]));

    // 九、宣传推广
    blocks.push(h1('九、宣传推广方案'));
    blocks.push(h2('渠道组合'));
    blocks.push(bullets(c.cfg.promoChannels));
    blocks.push(h2('宣传节奏'));
    blocks.push(table(
      ['阶段', '时间', '主要动作', '负责人', '目标'],
      promoRows(c),
      [1200, 1800, 3400, 1200, 1400]
    ));
    blocks.push(h2('文案要点'));
    blocks.push(bullets([
      '主标题：' + c.name + '｜' + c.slogan,
      '首段：用一句话讲清「谁、什么时候、在哪里、做什么、怎么报名」，控制在 100 字以内。',
      '报名引导：写明截止时间 ' + c.registrationDeadline + '、名额 ' + c.scale + ' 人与咨询方式 ' + c.contactPhone + '。',
      '安全提示：提前说明着装、交通、签到与散场要求，减少现场重复解释。'
    ]));
    blocks.push(p('所有对外文案发布前由宣传组与总负责人双人校对，重点核对时间、地点、报名方式与联系人，确认无误后再转发到各群。'));
    blocks.push(quote(c.slogan));

    // 十、物资清单
    blocks.push(h1('十、物资清单'));
    blocks.push(p('物资按 ' + c.scale + ' 名参与者、' + c.staffTotal + ' 名工作人员' + (c.guestPhrase ? c.guestPhrase : '') + '测算，签到表、饮用水等按 1.2 倍冗余准备。单价为校内打印店、超市与电商平台的参考价，实际采购以票据为准。'));
    blocks.push(table(
      ['序号', '物品名称', '规格', '单位', '数量', '单价（元）', '小计（元）', '备注'],
      c.materials.map(function (m, i) {
        return [String(i + 1), m.name, m.spec, m.unit, String(m.qty), moneyText(m.priceCents), moneyText(m.costCents), m.note || '—'];
      }),
      [500, 1600, 1800, 600, 700, 1000, 1100, 1700]
    ));
    blocks.push(p('物资清单合计 ' + moneyText(c.materialTotal) + ' 元，已计入经费预算的「物资物料」分项。可借用或自备的物资在备注中注明，不计入采购支出。'));
    blocks.push(h2('物资管理'));
    blocks.push(bullets([
      '采购：T-7 前完成询价，优先使用社团库存与可借用物资，单笔超过 200 元保留比价记录。',
      '入库：T-3 前完成清点，按「物品—数量—责任人」登记，贵重物品单独存放。',
      '领用：活动当天由各环节负责人签字领用，未使用物资当天归还。',
      '归还：租赁设备与场地物资在活动结束后 24 小时内归还并确认押金退还。'
    ]));

    // 十一、经费预算
    blocks.push(h1('十一、经费预算'));
    var funding = '社团会费、学院活动经费支持与必要时的校外赞助';
    blocks.push(p('本次活动预算总额 ' + moneyText(c.budget.totalCents) + ' 元，经费来源为' + funding + '；' + (c.fee === '免费' ? '活动不向参与者收取费用。' : '参与者费用标准为' + c.fee + '，由财务组统一收取并登记。')));
    if (c.budget.note) blocks.push(p(c.budget.note));
    blocks.push(h2('预算分项'));
    blocks.push(budgetSummaryTable(c));
    blocks.push(h2('预算明细'));
    blocks.push(budgetDetailTable(c));
    blocks.push(p('预算合计 ' + moneyText(c.budget.totalCents) + ' 元，与活动总额一致。分项占比已按本次活动的实际支出结构调整：' + topCategory(c) + '投入最高，其次是' + secondCategory(c) + '，具体明细见上表。'));
    blocks.push(h2('经费执行要求'));
    blocks.push(bullets([
      '单价参考校内打印店、场地管理与电商平台的现行价格，实际支出以票据为准。',
      '分项结余优先转入「应急备用」，不得用于与活动无关的支出。',
      '单笔支出超过 200 元需总负责人与财务组双签，超过 500 元报指导老师确认。',
      '活动结束后 3 天内完成决算，票据按类别粘贴并附支出明细。'
    ]));
    blocks.push(note('经费预算以审批金额为准；如实际支出与预算偏差超过 10%，须在活动总结中说明原因。'));

    // 十二、风险与应急
    blocks.push(h1('十二、风险预判与应急预案'));
    blocks.push(p('活动风险按「谁发现、谁报告、谁处置」的原则管理。筹备阶段重点排查场地、设备、天气与人员四类风险，活动当天由安全保障组每 30 分钟巡查一次，发现异常立即上报现场总指挥。'));
    var risks = commonRisks().slice(0, 6).concat(c.cfg.risks || []);
    blocks.push(table(
      ['序号', '风险点', '等级', '触发条件', '应对措施', '责任人'],
      risks.map(function (r, i) {
        return [String(i + 1), r.risk, r.level, r.trigger, r.action, r.owner];
      }),
      [600, 1400, 700, 2200, 3000, 1100]
    ));
    blocks.push(h2('应急联络'));
    blocks.push(kv([
      ['现场总指挥', c.contactName + '（' + c.contactPhone + '）'],
      ['医疗急救', '120；校内急救点位置见场地指引'],
      ['校园保卫处', '校内保卫处值班电话（见场地申请回执）'],
      ['场地管理方', '场地管理科（见场地申请回执）'],
      ['报名与咨询', c.contactName + ' / 活动群公告']
    ]));
    blocks.push(h2('应急处置流程'));
    blocks.push(numbers([
      '发现：第一时间保护现场并确认人员安全，必要时拨打 120 或联系保卫处。',
      '上报：5 分钟内向现场总指挥报告，说明地点、人数、伤情与已采取的措施。',
      '处置：启动对应预案，安全组维持秩序，宣传组统一对外口径，避免信息混乱。',
      '复盘：事件处理完毕后 24 小时内形成书面记录，纳入活动总结。'
    ]));

    // 十三、效果评估
    blocks.push(h1('十三、效果评估与考核指标'));
    blocks.push(p('评估采用「过程数据 + 结果反馈」的方式：过程数据来自签到表与报名表，结果反馈来自问卷与传播数据。所有指标在活动结束后 3 天内完成统计，作为总结与改进的依据。'));
    var metrics = commonMetrics(c).concat(c.cfg.metrics || []);
    blocks.push(table(
      ['指标', '目标值', '统计方式', '责任人'],
      metrics.map(function (m) {
        return [m.name, tp(m.target, c), m.method, m.owner || '策划组'];
      }),
      [2000, 1800, 3600, 1600]
    ));
    blocks.push(bullets([
      '数据来源：签到表、报名表、问卷、公众号后台与财务票据，活动后统一汇总到复盘表。',
      '复盘安排：活动结束后 3 天内召开复盘会，7 天内完成总结归档。',
      '改进闭环：每个问题对应 1 条改进措施，明确责任人与完成时间，纳入下一次活动检查。'
    ]));

    // 十四、注意事项
    blocks.push(h1('十四、注意事项'));
    var cautions = [
      '安全第一：活动期间保持疏散通道畅通，禁止私拉电线，发现隐患立即停止相关环节。',
      '时间纪律：工作人员提前 1 小时到场，各环节负责人提前 10 分钟到岗，不得迟到或缺岗。',
      '场地与设备：使用前检查设备并登记，结束后恢复场地原状，损坏设施照价赔偿。',
      '拍摄与隐私：拍摄前告知参与者，涉及未成年人或不愿出镜者须征得同意，照片不得用于商业用途。',
      '物资与财务：物资领用登记，临时采购保留票据，活动结束后统一结算。',
      '信息发布：对外信息以宣传组统一口径为准，未经审核不得擅自发布。'
    ];
    noticePointsFor(c).forEach(function (x) { cautions.push(x + '。'); });
    blocks.push(numbers(cautions));
    blocks.push(p('以上事项在活动前 1 天的行前会上逐条确认，由各组组长签字。活动结束后，策划组将执行情况与问题清单整理进总结，作为下次活动的检查项。'));

    // 十五、附件与审批
    blocks.push(h1('十五、附件与审批'));
    blocks.push(p('本策划书连同以下材料一并提交审批，审批通过后方可开展宣传与报名。材料电子版统一存放在社团共享文件夹，纸质版按顺序装订。'));
    blocks.push(numbers([
      '《' + c.planTitle + '》（本文件）',
      '《场地使用申请表》（需场地管理科与保卫处签字）',
      '《活动经费预算表》（附分项明细）',
      '《活动安全承诺书》（全体工作人员签字）',
      '《' + c.name + '报名表》模板与报名链接说明'
    ]));
    blocks.push(p('审批流程：指导老师初审→社团管理部门复核→场地管理科确认场地→保卫处备案。各环节一般在 2 个工作日内完成，建议提前 10 个工作日启动。'));
    blocks.push(p('联系人：' + c.contactName + '，电话 ' + c.contactPhone + '。如需调整活动时间、地点或规模，须在活动前 3 天提交变更说明。'));

    return {
      title: c.planTitle,
      subtitle: c.org + ' · ' + c.activityWord + '活动',
      meta: meta,
      blocks: blocks,
      footer: c.org + ' · ' + c.name + ' · 策划书'
    };
  }

  function topCategory(c) {
    var list = c.budget.summary.slice().sort(function (a, b) {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.key < b.key ? -1 : 1;
    });
    return list.length ? list[0].label : '物资物料';
  }

  function secondCategory(c) {
    var list = c.budget.summary.slice().sort(function (a, b) {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.key < b.key ? -1 : 1;
    });
    return list.length > 1 ? list[1].label : '应急备用';
  }

  /* ---------- 场地使用申请表 ---------- */
  function buildVenueForm(c) {
    var applyDate = c.dateIso ? dateCN(addDaysISO(c.dateIso, -7)) : '待定';
    var blocks = [];
    blocks.push(kv([
      ['申请单位', c.org],
      ['活动名称', c.name],
      ['活动类型', c.typeLabel],
      ['使用时间', c.dateCN + ' ' + c.timeStart + '—' + c.timeEnd],
      ['使用场地', c.place],
      ['预计人数', c.totalPeople + ' 人（参与者 ' + c.scale + ' 人，工作人员 ' + c.staffTotal + ' 人' + (c.guestCount ? '，嘉宾 ' + c.guestCount + ' 人' : '') + '）'],
      ['活动用途', c.activityWord + '活动：' + c.theme],
      ['设备需求', c.venueNeeds],
      ['多媒体需求', '投影、无线话筒、音响；如场地条件不足，自备蓝牙音箱与备用电脑'],
      ['联系人', c.contactName],
      ['联系电话', c.contactPhone],
      ['申请日期', applyDate]
    ]));
    blocks.push(h2('安全承诺'));
    blocks.push(numbers([
      '活动期间遵守场地管理规定，不擅自改动电源、消防设施与固定设备。',
      '严格控制入场人数不超过 ' + c.totalPeople + ' 人，保持疏散通道和安全出口畅通。',
      '活动结束后 1 小时内完成清场，垃圾自行带走，损坏设施照价赔偿。',
      '如遇突发情况，第一时间联系场地管理员与保卫处，服从现场指挥。'
    ]));
    blocks.push(h2('审批意见'));
    blocks.push(table(
      ['审批环节', '审批意见', '签字', '日期'],
      [
        ['指导老师意见', '□同意　□不同意', '—', '—'],
        ['社团管理部门意见', '□同意　□不同意', '—', '—'],
        ['场地管理科意见', '□同意　□不同意', '—', '—'],
        ['保卫处备案意见', '□同意　□不同意', '—', '—']
      ],
      [1800, 3600, 1600, 2000]
    ));
    blocks.push(note('本表一式两份，申请单位与场地管理科各执一份；请提前 7 个工作日提交，活动当天携带复印件备查。'));
    blocks.push(p('申请单位（盖章）：' + c.org, 'right'));
    blocks.push(p(applyDate, 'right'));
    return {
      title: '场地使用申请表',
      subtitle: c.name,
      blocks: blocks,
      footer: c.org + ' · 场地使用申请表'
    };
  }

  /* ---------- 活动通知 ---------- */
  function buildNotice(c) {
    var noticeDate = c.dateIso ? dateOnlyCN(addDaysISO(c.dateIso, -10)) : '待定';
    var intro = c.purpose ? c.purpose.replace(/[。；;]+$/, '') : tp(c.cfg.purposes[0], c).replace(/[。；;]+$/, '');
    var contentItems = c.cfg.flow.slice(1, 5).map(function (f) {
      return '「' + f.name + '」：' + f.content;
    });
    var noticePoints = noticePointsFor(c).map(function (x) {
      return /[。！？]$/.test(x) ? x : x + '。';
    });
    var cautions = noticePoints.concat([
      '请提前 15 分钟到达现场签到，活动开始后请将手机调至静音。',
      '活动期间请保管好个人财物，听从工作人员引导，如需帮助请联系现场工作人员。',
      '如报名后无法参加，请至少提前 1 天告知，以便将名额让给候补同学。'
    ]);
    var blocks = [];
    blocks.push(p('各位同学：'));
    blocks.push(p('为进一步丰富校园文化生活，' + intro + '。' + c.org + '定于 ' + c.dateCN + ' ' + c.timeStart + '—' + c.timeEnd + '在' + c.place + '举办「' + c.name + '」，现将有关事项通知如下：'));
    blocks.push(h2('一、活动安排'));
    blocks.push(kv([
      ['活动主题', c.theme],
      ['活动时间', c.dateCN + ' ' + c.timeStart + '—' + c.timeEnd],
      ['活动地点', c.place],
      ['活动对象', c.audience],
      ['预计规模', c.scale + ' 人'],
      ['活动嘉宾', c.guestLabel]
    ]));
    blocks.push(h2('二、活动内容'));
    blocks.push(bullets(contentItems));
    blocks.push(h2('三、报名方式'));
    blocks.push(numbers([
      '报名时间：即日起至 ' + c.registrationDeadline + '。',
      '报名方式：扫描通知所附二维码，填写《' + c.name + '报名表》；报名信息仅用于活动组织与签到核对。',
      '名额 ' + c.scale + ' 人，按报名先后顺序确认，报名结果将在活动群内公布，请注意查收。',
      '如需修改信息或请假，请联系 ' + c.contactName + '（' + c.contactPhone + '）。'
    ]));
    blocks.push(h2('四、注意事项'));
    blocks.push(bullets(cautions));
    blocks.push(note('请各班级、社团会员群及时转发本通知，报名二维码与活动群二维码以官方发布为准。'));
    blocks.push(p(c.org, 'right'));
    blocks.push(p(noticeDate, 'right'));
    blocks.push(quote(c.slogan));
    return {
      title: c.noticeTitle,
      subtitle: c.org,
      blocks: blocks,
      footer: c.org + ' · 活动通知'
    };
  }

  /* ---------- 执行手册 ---------- */
  function buildHandbook(c) {
    var blocks = [];
    var risks = commonRisks().slice(0, 4).concat((c.cfg.risks || []).slice(0, 2));
    blocks.push(h1('一、当天流程'));
    blocks.push(p('以下为活动现场执行版流程，时间为计划时间。主持人、计时员与各组组长各持一份，现场调整以总负责人指令为准。'));
    blocks.push(table(
      ['时间', '环节', '负责人', '现场动作', '所需物料'],
      c.flow.map(function (f) {
        return [f.time, f.name, f.owner, f.content, suppliesFor(f.name)];
      }),
      [1600, 1600, 1400, 3000, 1400]
    ));
    blocks.push(h1('二、现场分工'));
    blocks.push(p('所有工作人员提前 1 小时到场，签到后领取工作证与对讲机，按以下岗位就位。岗位之间保持对讲机畅通，临时调动由总负责人统一安排。'));
    blocks.push(table(
      ['岗位', '负责人', '人数', '站位与职责'],
      c.roles.map(function (r) {
        return [r.role, r.owner, String(r.count), staffStation(r.role) + '；' + r.duty];
      }),
      [1600, 1400, 700, 5300]
    ));
    blocks.push(h1('三、联络表'));
    blocks.push(table(
      ['岗位', '姓名', '联系方式', '备注'],
      [
        ['现场总指挥', c.contactName, c.contactPhone, '统一决策与对外沟通'],
        ['场地管理员', '场地管理科值班人员', '以场地申请回执为准', '设备、电力与场地问题'],
        ['医疗急救', '校医院值班室', '120', '伤情处置与转运'],
        ['校园保卫处', '保卫处值班人员', '以校内通讯录为准', '秩序与突发事件'],
        ['各组组长', '见活动群通讯录', '活动群内更新', '组内人员调度']
      ],
      [1600, 2000, 2200, 3200]
    ));
    blocks.push(h1('四、应急预案速查'));
    blocks.push(p('遇到突发情况先保护人员安全，再按「发现—上报—处置—复盘」流程处理。以下为高频场景的第一时间动作。'));
    blocks.push(table(
      ['场景', '第一时间动作', '上报对象', '联系方式'],
      risks.map(function (r) {
        return [r.risk, r.action, r.owner, /安全|伤/.test(r.risk) ? '120 / 校医院' : '现场总指挥'];
      }),
      [1600, 4200, 1600, 1600]
    ));
    blocks.push(h1('五、开场前检查'));
    blocks.push(bullets([
      '签到台：签到表、签字笔、工作证、桌牌、二维码立牌齐备，签到通道不少于 2 条。',
      '设备：投影、音响、话筒、翻页笔逐项测试 2 遍，备用电脑与蓝牙音箱处于可用状态。',
      '动线：入口、签到处、观众区、嘉宾区、疏散通道标识清晰，隔离带固定牢靠。',
      '补给：饮用水、茶歇、纸巾按人数摆放，垃圾袋与清洁工具放在隐蔽位置。',
      '应急：急救包、一次性雨衣、备用电源与手电筒放在固定点位，安全组全员知晓位置。',
      '财务：备用金、票据夹与收费登记表齐备，收费与找零由 2 人共同经手。',
      '对时：全体工作人员以手机网络时间为准对时，各组组长确认后在工作群回复。'
    ]));
    blocks.push(h1('六、结束后收尾'));
    blocks.push(numbers([
      '清场：引导参与者离场，检查座位区与通道是否有遗留物品，垃圾集中清运。',
      '物资：按清单清点、归还租赁设备与场地物资，未使用物品登记入库。',
      '数据：导出签到与报名数据，统计到场率，保存问卷原始结果。',
      '素材：摄影组当天完成照片初筛，标注可用素材并上传共享文件夹。',
      '复盘：活动结束后 24 小时内在工作群完成一次快速复盘，记录 3 个亮点与 3 个问题。'
    ]));
    blocks.push(note('本手册为现场执行版，活动前 1 天定稿；临时变更须经总负责人确认并在工作群同步。'));
    return {
      title: '「' + c.name + '」执行手册',
      subtitle: '现场执行版 · ' + c.org,
      meta: [
        ['活动时间', c.dateCN + ' ' + c.timeStart + '—' + c.timeEnd],
        ['活动地点', c.place],
        ['现场总指挥', c.contactName + '（' + c.contactPhone + '）'],
        ['参与规模', c.scale + ' 人 + 工作人员 ' + c.staffTotal + ' 人'],
        ['版本', '现场执行版 v1.0（活动前 1 天定稿）']
      ],
      blocks: blocks,
      footer: c.org + ' · 内部执行手册'
    };
  }

  /* ---------- 报名表模板 ---------- */
  function buildSignTemplate(c) {
    var sampleDate = c.dateIso ? addDaysISO(c.dateIso, -8) : '2026-05-10';
    var headers = ['序号', '姓名', '学号', '学院', '年级', '专业', '班级', '性别', '手机号', 'QQ或微信', '是否会员', '饮食禁忌', '服装尺码', '参与场次', '报名时间', '备注'];
    var rows = [
      headers.slice(),
      ['1', '张明', '2023120101', '计算机学院', '2023级', '计算机科学与技术', '计科2301', '男', '13800000001', 'zhangming2023', '是', '无', 'L', '第一场', sampleDate + ' 09:15', '希望参与现场互动'],
      ['2', '李思雨', '2024110208', '外国语学院', '2024级', '英语', '英语2402', '女', '13800000002', 'lisiyu_2024', '否', '清真', 'M', '第二场', sampleDate + ' 10:42', '需要靠前座位'],
      ['3', '王浩', '2022120315', '机械工程学院', '2022级', '机械设计制造及其自动化', '机制2203', '男', '13800000003', 'wanghao_2004', '是', '素食', 'XL', '第一场', sampleDate + ' 13:07', '可协助搬运物资']
    ];
    var tips = [
      ['序号', '由工作人员统一填写，请勿自行编号'],
      ['姓名', '填写真实姓名，与校园卡保持一致'],
      ['学号', '10 位学号，用于签到与活动证明'],
      ['学院', '填写完整学院名称，如「计算机科学与技术学院」'],
      ['年级', '统一填写为「2023级」格式'],
      ['手机号', '用于接收活动通知，请确保号码可接通'],
      ['QQ或微信', '填写常用账号，便于拉入活动群'],
      ['是否会员', '填写「是」或「否」'],
      ['饮食禁忌', '如无禁忌填「无」；有过敏或宗教饮食要求请具体说明'],
      ['服装尺码', '统一填写 S/M/L/XL/XXL'],
      ['参与场次', '按通知提供的场次填写，如「第一场」'],
      ['报名时间', '填写提交当天的日期与时间，如 2026-05-10 09:15'],
      ['备注', '可填写技能、可协助岗位或特殊需求']
    ];
    return {
      title: c.name + '报名表',
      sheets: [
        {
          name: '报名表',
          rows: rows,
          widths: [6, 10, 14, 16, 8, 16, 12, 6, 14, 16, 9, 14, 10, 10, 17, 24]
        },
        {
          name: '填写说明',
          rows: tips,
          widths: [16, 60]
        }
      ]
    };
  }

  /* ---------- 办活动清单与提醒 ---------- */
  function buildChecklist(c) {
    var list = [
      '活动前 14 天：确定方案、主题与预算，报指导老师审批',
      '活动前 14 天：提交场地使用申请表，确认场地与设备回执',
      '活动前 10 天：完成主视觉、海报与预告推文，发布第一轮宣传',
      '活动前 7 天：发布正式通知与报名表，开启报名并建立活动群',
      '活动前 7 天：确认嘉宾、评委或演出人员档期与设备需求',
      '活动前 5 天：按报名趋势预估人数，锁定物资采购与借用清单',
      '活动前 3 天：完成报名统计，按实际人数调整物资与座位',
      '活动前 3 天：完成第二轮宣传与班级群定向转发',
      '活动前 3 天：完成流程走场与设备联调，确认备用方案',
      '活动前 1 天：打印签到表、流程单、桌牌与证书',
      '活动前 1 天：完成场地布置与安全隐患排查',
      '活动前 1 天：召开行前会，明确分工、对讲与应急流程',
      '活动当天提前 2 小时：到场布置签到台、设备与物料',
      '活动当天提前 30 分钟：完成签到、引导与设备最终检查',
      '活动结束后 1 小时内：完成清场、物资清点与设备归还',
      '活动结束后 3 天内：完成照片归档、新闻稿与经费决算',
      '活动结束后 7 天内：完成复盘会与活动总结归档'
    ];
    if (c.cfg.checkExtra) list.splice(6, 0, c.cfg.checkExtra);
    return list;
  }

  function buildTips(c) {
    var list = [
      '报名截止设在活动前 3 天，留出 1 天核对名单与物资；截止后只做候补，不直接加人。',
      '预算中的「应急备用」不要挪作日常开销，现场临时采购优先从这里支出并保留小票。',
      '所有对外文案发布前由宣传组与总负责人双人校对时间、地点、报名方式，避免转发错误版本。',
      '活动结束后 24 小时内先发现场速报，3 天内发完整新闻稿，传播效果最好。'
    ];
    var keySeg = c.cfg.flow[3] || c.cfg.flow[2] || c.cfg.flow[0];
    list.push('本次活动的关键节点是「' + keySeg.name + '」，建议由' + keySeg.role + '提前 15 分钟确认场地、物料与人员到位。');
    return list;
  }

  /* ============================================================
   * 五、公开 API
   * ============================================================ */
  /**
   * 生成活动全流程内容。
   * @param {Object} input 活动信息，所有字段均可选；数字字段支持数字或数字字符串。
   * @returns {{info: Object, doc: Object, venueForm: Object, notice: Object,
   *            handbook: Object, signTemplate: Object, checklist: string[], tips: string[]}}
   */
  function generate(input) {
    var c = buildContext(input);
    var info = {
      name: c.name,
      type: c.typeLabel,
      theme: c.theme,
      org: c.org,
      coOrg: c.coOrg,
      date: c.date,
      timeStart: c.timeStart,
      timeEnd: c.timeEnd,
      place: c.place,
      scale: c.scale,
      audience: c.audience,
      contactName: c.contactName,
      contactPhone: c.contactPhone,
      budget: c.budget.totalCents / 100,
      fee: c.fee,
      registrationDeadline: c.registrationDeadline,
      needVenue: c.needVenue
    };
    return {
      info: info,
      doc: buildPlanDoc(c),
      venueForm: buildVenueForm(c),
      notice: buildNotice(c),
      handbook: buildHandbook(c),
      signTemplate: buildSignTemplate(c),
      checklist: buildChecklist(c),
      tips: buildTips(c)
    };
  }

  global.CLUB = global.CLUB || {};
  global.CLUB.plan = { generate: generate };
})(typeof window !== 'undefined' ? window : globalThis);

