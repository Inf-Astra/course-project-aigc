/* ---- js/summary.js ---- */
/* summary.js — 新闻稿 / 活动总结 / 社媒文案写作引擎
   读取活动档案、流程、金句与报名统计结果，输出三份 DocSpec（只产出结构，不产出 HTML/XML）。
   零依赖、纯函数、确定性：相同输入必然得到逐字节相同的输出；不触碰 DOM、不使用随机与时钟。
   对 CLUB.stats 的结果按 CONTRACT 第 6 节字段防御式读取：stats 缺失或字段不全时自动降级为合理默认值。
*/
(function (global) {
  'use strict';

  /* =======================================================================
   * 0. 基础工具
   * ===================================================================== */

  /** 安全取字符串并去首尾空白 */
  function s(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  /** 安全取数字，非法值回落默认值 */
  function n(v, dft) {
    if (v === null || v === undefined || v === '') return dft;
    if (typeof v === 'number') return isFinite(v) ? v : dft;
    var x = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isFinite(x) ? x : dft;
  }

  /** 四舍五入到指定位数 */
  function round(x, d) {
    var p = Math.pow(10, d || 0);
    return Math.round(x * p) / p;
  }

  /** 百分比字符串，1 位小数 */
  function pctStr(part, total) {
    if (!total || total <= 0) return '0.0%';
    return round((part / total) * 100, 1).toFixed(1) + '%';
  }

  /** 数字（金额）取整展示 */
  function yuan(x) {
    var v = Math.round(n(x, 0));
    return v === 0 ? '0' : String(v);
  }

  /** 确定性哈希（字符串 → 非负整数），用于按输入挑选措辞，不参与内容事实 */
  function hash(str) {
    var t = s(str), h = 5381, i;
    for (i = 0; i < t.length; i++) {
      h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  /** 按种子从数组里挑一个（确定性） */
  function pick(list, seed) {
    if (!list || !list.length) return '';
    return list[Math.abs(seed || 0) % list.length];
  }

  /** 字符数（不含空白，代理对按 1 个字符计） */
  function chars(v) {
    return Array.from(s(v).replace(/\s+/g, '')).length;
  }

  /** 按字符数截断，超出时用省略号 */
  function clip(v, limit, tail) {
    var a = Array.from(s(v));
    if (a.length <= limit) return s(v);
    var t = tail === undefined ? '…' : tail;
    return a.slice(0, Math.max(1, limit - Array.from(t).length)).join('') + t;
  }

  /** 补句号（已有句末标点则不动） */
  function end(t) {
    var v = s(t);
    if (!v) return '';
    if (/[。！？…」』”’)）]$/.test(v)) return v;
    return v + '。';
  }

  /** 去掉句末标点 */
  function stripEnd(t) {
    return s(t).replace(/[。！？；;，,]+$/, '');
  }

  /** 模板填充：{key} → vars[key] */
  function fill(tpl, vars) {
    var t = s(tpl);
    // 活动名/主题本身已带书名号时，避免模板再包一层产生「「…」」或落单的」
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        var v = vars[k] === null || vars[k] === undefined ? '' : String(vars[k]);
        if (/[「」“”《》]/.test(v)) t = t.split('「{' + k + '}」').join('{' + k + '}');
      });
    }
    return t.replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : '';
    });
  }

  /** 给活动名加书名号（已带书名号则原样返回） */
  function qn(name) {
    var t = s(name);
    if (!t) return '「活动」';
    return /[「」“”《》]/.test(t) ? t : '「' + t + '」';
  }

  /** 标点整理：活动名自带书名号时避免出现「「…」」这类嵌套 */
  function scrub(t) {
    return s(t)
      .replace(/「「/g, '「')
      .replace(/」」/g, '」')
      .replace(/““/g, '“')
      .replace(/””/g, '”');
  }

  /** 对输出结构内的所有字符串做标点整理（保持结构不变） */
  function scrubDeep(v) {
    if (typeof v === 'string') return scrub(v);
    if (Object.prototype.toString.call(v) === '[object Array]') {
      return v.map(scrubDeep);
    }
    if (v && typeof v === 'object') {
      var out = {};
      for (var k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = scrubDeep(v[k]);
      }
      return out;
    }
    return v;
  }

  /** 数组化：支持数组、换行/分号/顿号分隔的文本 */
  function toList(v) {
    if (Object.prototype.toString.call(v) === '[object Array]') {
      return v.map(s).filter(Boolean);
    }
    var t = s(v);
    if (!t) return [];
    var parts = t.split(/[\n\r]+|[；;]+/).map(s).filter(Boolean);
    if (parts.length > 1) return parts;
    var byComma = t.split(/[、，,]+/).map(s).filter(Boolean);
    if (byComma.length > 1) return byComma;
    return parts;
  }

  /** 句子级拆分（用于问题/改进这类成句素材） */
  function toSentences(v) {
    if (Object.prototype.toString.call(v) === '[object Array]') {
      return v.map(s).filter(Boolean);
    }
    var t = s(v);
    if (!t) return [];
    var lines = t.split(/[\n\r]+/).map(s).filter(Boolean);
    if (lines.length > 1) return lines;
    var semi = t.split(/[；;]+/).map(s).filter(Boolean);
    if (semi.length > 1) return semi;
    var byStop = t.split(/[。]+/).map(s).filter(Boolean);
    if (byStop.length > 1) return byStop;
    return lines;
  }

  /** 中文编号 */
  var CN_ORD = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

  /* =======================================================================
   * 1. 活动类型资料库（措辞、默认流程、金句、亮点、问题、后续）
   * ===================================================================== */

  var TYPES = {
    lecture: {
      key: 'lecture', label: '讲座', verb: '开讲', noun: '讲座', genre: '学术讲座',
      form: '主题分享与互动问答', theme: '专业成长与青年担当',
      audience: '全校对专业成长感兴趣的同学',
      goal: '把课堂之外的经验与方法讲给愿意提问的人听',
      title: [
        '{name}开讲：把「{theme}」讲进同学心里',
        '一场关于「{theme}」的长谈：记{name}',
        '{name}侧记：{actual}名同学同上一堂课'
      ],
      subtitle: [
        '围绕「{theme}」，{org}为同学补上一堂成长必修课',
        '从「{theme}」出发，把经验与方法讲给愿意提问的人'
      ],
      scene: [
        '活动开始前半小时，{place}门口已经排起签到队伍，工作人员一边核对报名名单，一边把活动资料袋递到同学手中',
        '场内背景板上「{name}」几个字被灯箱打得格外清晰，座位从中间过道一直加到最后一排，仍有同学搬来折叠椅坐在过道边',
        '屏幕循环播放着社团过去一年的活动剪影，不少提前到场的同学凑在展板前，用手机拍下感兴趣的日程'
      ],
      comment: '分享中没有照本宣科的幻灯片，主讲人几次停下来，用自己在实验室和实习中的例子解释抽象概念，台下的笔记声几乎没有停过',
      plan: [
        { name: '签到入场', desc: '工作人员核验报名信息、发放资料，引导同学按区域就座' },
        { name: '开场介绍', desc: '主持人介绍活动缘起与到场嘉宾，播放社团年度活动剪影' },
        { name: '主题分享', desc: '主讲人围绕主题展开分享，从个人经历讲到可操作的方法' },
        { name: '互动问答', desc: '现场同学举手提问，主讲人逐一回应，并送出社团文创' },
        { name: '总结合影', desc: '负责人致谢、抽取幸运观众，全体人员合影留念' }
      ],
      quotes: [
        { who: '一位连续参加三期活动的大二同学', text: '原来觉得这个话题离自己很远，听完才发现它就在我的课表和实习里' },
        { who: '活动负责人', text: '我们想做的不只是请人来讲话，而是让同学带着一个问题来、带着一个方法走' }
      ],
      highlights: [
        '**内容接地气**：「{theme}」这个看似宏大的题目被拆成可执行的三步，现场笔记与拍照记录几乎没有停过',
        '**互动充分**：问答环节共回应{questionCount}个问题，问题提前在群内征集，质量明显高于往年',
        '**组织顺畅**：{staffCount}名工作人员分签到、场务、宣传、机动四组，{stepCount}个环节衔接紧凑',
        '**数据留痕**：报名、签到、问卷三段数据完整留存，为下一期选题提供了依据'
      ],
      problems: [
        '宣传启动偏晚，报名集中在活动前两天，物料与座位的准备时间被压缩（来源：筹备复盘）',
        '问答环节时间偏紧，部分同学举手后未能提问，互动节奏还可以更从容（来源：现场记录）',
        '签到依赖纸质名单，高峰时段排队明显，入场体验受到影响（来源：现场观察）'
      ],
      next: [
        '围绕同一主题开设第二期，把单次讲座做成每月一期的系列栏目',
        '把讲座内容整理成图文与短视频，纳入社团资料库，供未能到场的同学回看'
      ]
    },

    contest: {
      key: 'contest', label: '比赛', verb: '开赛', noun: '比赛', genre: '赛事',
      form: '限时赛题、现场评审与答辩', theme: '用专业能力解决真实问题',
      audience: '对专业实践感兴趣的在校学生',
      goal: '以赛促学，让同学在真实任务里检验所学',
      title: [
        '{name}收官：{teamCount}支队伍同场竞技，{awardShort}',
        '{name}开赛：{actual}名选手在{place}展开角逐',
        '一场硬仗的复盘：{name}侧记'
      ],
      subtitle: [
        '以「{theme}」为题，把课堂知识放到真实任务里检验',
        '{org}搭台，{actual}名同学用{hours}小时完成一次真刀真枪的演练'
      ],
      scene: [
        '离签到还有二十分钟，{place}里已经响起键盘与讨论声，参赛队伍围坐成圈，最后一次核对分工与设备',
        '签到台上摞着号码牌与赛题袋，工作人员逐队确认到场人数并引导入座，墙面投影的倒计时从三十分钟开始跳动',
        '评审席前铺着评分表，计分屏上的队伍编号一行行亮起，场边还设了给同学拍照留念的打卡板'
      ],
      comment: '赛题贴近校园里的真实问题，评审巡场时反复提醒“先跑通，再优化”，临近截止，几支队伍抱着电脑在走廊里做最后的联调',
      plan: [
        { name: '签到检录', desc: '工作人员逐队核验学生证、发放号码牌与赛题袋' },
        { name: '规则说明', desc: '主持人宣读赛制、评分维度与注意事项，评审代表说明标准' },
        { name: '限时竞赛', desc: '各队伍围绕赛题展开创作与调试，评审巡场记录' },
        { name: '提交与答辩', desc: '队伍按要求提交作品，入围队伍进入现场答辩' },
        { name: '评审与颁奖', desc: '评审合议打分，公布结果并颁发奖项，全体合影' }
      ],
      quotes: [
        { who: '冠军队队长', text: '最后两个小时我们几乎推翻了重做，能撑下来是因为没有一个人先走' },
        { who: '评审老师', text: '今年作品的整体完成度比去年高，说明同学们真的把时间花在了动手上' }
      ],
      highlights: [
        '**赛制清晰**：赛题、评分维度与提交规范在赛前一周公布，现场未出现申诉',
        '**参与面广**：{actual}名选手来自{collegeCount}个院系，跨专业组队占比明显提升',
        '**成果可见**：共提交{workCount}件作品，{awardCount}支队伍获奖，优秀作品将推荐参加更高层级赛事',
        '**保障到位**：现场配备备用电源、网络与医疗点，{staffCount}名工作人员全程值守'
      ],
      problems: [
        '部分队伍在截止前集中提交，服务器与打印点出现短时排队，提交环节需要更细的分流（来源：现场记录）',
        '赛题难度梯度不够明显，基础较弱的队伍在中段掉队，线上答疑需求未被充分满足（来源：赛后问卷）',
        '评审与答辩时间被压缩，个别队伍的作品展示只讲了一半（来源：评审反馈）'
      ],
      next: [
        '推荐获奖作品参加校级、省级赛事，并安排指导教师做一对一打磨',
        '把赛题、优秀作品与评审意见整理成公开案例库，作为下一届的备赛资料'
      ]
    },

    performance: {
      key: 'performance', label: '演出', verb: '上演', noun: '演出', genre: '演出',
      form: '节目展演与嘉宾点评', theme: '让青春的每一种表达都被看见',
      audience: '全校师生',
      goal: '给有表达欲的同学一个被看见的舞台',
      title: [
        '{name}上演：{programCount}个节目，{actual}名同学把舞台点亮',
        '灯光亮起的那一刻：记{name}',
        '{name}落幕：{programCount}个节目，一场共同完成的青春表达'
      ],
      subtitle: [
        '以「{theme}」为名，把排练室里的坚持交给舞台检验',
        '从排练到谢幕，{org}用一场演出回答“我们想说什么”'
      ],
      scene: [
        '舞台灯光在开场前半小时完成对光，后台化妆间里，演员们对着镜子最后一遍过词',
        '{place}入口两侧摆着节目单与花篮，签到台的志愿者引导观众按票入座，前排留出了摄影位',
        '开场前十分钟，场内已经坐满，后排同学干脆站到两侧过道，等待第一束追光落下'
      ],
      comment: '从第一个节目到返场，灯光、伴奏与舞美衔接得几乎没有停顿，后台用对讲机把每一次换场卡在三十秒内',
      plan: [
        { name: '观众入场', desc: '检票、引导入座，发放节目单与荧光棒' },
        { name: '开场节目', desc: '开场歌舞点燃气氛，主持人介绍演出主题与嘉宾' },
        { name: '节目展演', desc: '按节目单依次演出，涵盖歌舞、语言类与器乐节目' },
        { name: '嘉宾点评与互动', desc: '嘉宾点评、现场抽奖与观众互动环节' },
        { name: '谢幕合影', desc: '全体演员谢幕，主创上台致谢并合影' }
      ],
      quotes: [
        { who: '一位第一次上台的大一演员', text: '彩排时还忘词，真正站上去反而不紧张了，台下的掌声是最好的提示音' },
        { who: '一位观众', text: '原本只打算看两个节目就走，结果一直坐到了谢幕' }
      ],
      highlights: [
        '**节目原创**：{programCount}个节目中有{originalCount}个为社团原创或改编，语言类节目贴近校园生活',
        '**舞台执行**：灯光、音响与舞美由学生团队完成，{staffCount}名工作人员把每次换场控制在三十秒内',
        '**观众反响**：现场{actual}名观众，演出中掌声与合唱多次打断节目衔接',
        '**传播延长**：演出片段在短视频平台获得约{reach}次播放，为社团账号带来新增关注'
      ],
      problems: [
        '彩排时间不足，个别节目的走位与灯光配合在正式演出时仍有瑕疵（来源：舞台监督记录）',
        '后台空间有限，演员换装与道具转换相互干扰，动线需要重新规划（来源：现场观察）',
        '宣传集中在演出前一周，部分同学反映“知道时票已经发完了”（来源：观众反馈）'
      ],
      next: [
        '把优秀节目打磨成社团保留剧目，参与校内外联合演出',
        '建立节目孵化机制，每学期固定两次内部展演，提前筛选成熟作品'
      ]
    },

    volunteer: {
      key: 'volunteer', label: '志愿服务', verb: '开展', noun: '志愿服务活动', genre: '志愿服务',
      form: '分组服务与集中复盘', theme: '让善意落在具体的地方',
      audience: '热心公益的在校学生',
      goal: '用可持续的服务回应社区与校园的真实需要',
      title: [
        '{name}开展：{actual}名志愿者用{hours}小时做了一件小事',
        '把「{theme}」写进日常：{name}侧记',
        '{name}：一场从清晨开始的志愿服务'
      ],
      subtitle: [
        '以「{theme}」为出发点，{org}把服务做到了具体的人身边',
        '不喊口号，只做具体的事——记一次志愿服务'
      ],
      scene: [
        '清晨的{place}还带着凉意，志愿者已在校门口集合，按小组领取马甲、手套与物资清单',
        '签到表上的名字被一一勾选，负责人用十分钟讲完分工与安全注意事项，各小组随即散开行动',
        '工具车旁堆着分类好的垃圾袋与指示牌，几名同学蹲在地上把贴纸一张张抚平，免得被风吹起'
      ],
      comment: '服务过程中，志愿者把遇到的问题记在随身的小本上，回到集合点后再逐条复盘：哪些做得好、哪些下次要改',
      plan: [
        { name: '集合与分工', desc: '志愿者集合签到，领取马甲与物资，负责人讲解分工与安全事项' },
        { name: '分组服务', desc: '按小组开展服务，志愿者对照清单逐项完成任务' },
        { name: '集中复盘', desc: '各组回到集合点汇报进展，记录遇到的问题与改进点' },
        { name: '收尾与合影', desc: '清点物资、清理现场，全体志愿者合影' }
      ],
      quotes: [
        { who: '第一次参加志愿服务的同学', text: '原以为只是帮忙搬东西，真正做完才发现，耐心比力气更重要' },
        { who: '带队负责人', text: '我们更在意服务有没有真的解决问题，而不是照片拍得够不够好看' }
      ],
      highlights: [
        '**服务有清单**：任务按清单拆分到人，{actual}名志愿者完成{taskCount}项服务，未出现空转',
        '**安全有预案**：出发前完成安全提示与分组联络，现场配备药品与应急联系人',
        '**复盘有记录**：服务结束后当场复盘，形成{noteCount}条改进意见，纳入下次预案',
        '**带动有余量**：活动后有{n}名同学主动询问加入方式，志愿服务队伍进一步扩大'
      ],
      problems: [
        '服务点位分散，物资调配依赖人工往返，效率偏低（来源：现场记录）',
        '行前培训时间短，部分志愿者对服务对象的注意事项了解不够（来源：带队反馈）',
        '服务时段与同学课表冲突，个别时段人手紧张（来源：排班记录）'
      ],
      next: [
        '把服务点位、物资与排班整理成标准手册，形成可复制的服务流程',
        '与社区、公益机构建立长期合作，把一次性服务变成固定项目'
      ]
    },

    salon: {
      key: 'salon', label: '沙龙', verb: '举办', noun: '沙龙', genre: '沙龙',
      form: '围坐对谈与自由讨论', theme: '在对话里找到同路人',
      audience: '愿意坐下来聊聊的同学',
      goal: '用低压力的对话，让经验和困惑都能被听见',
      title: [
        '{name}：一场没有标准答案的对话',
        '围坐一圈，聊透「{theme}」：记{name}',
        '{name}侧记：{actual}名同学聊到忘了时间'
      ],
      subtitle: [
        '以「{theme}」为话题，{org}把分享变成了一场平等的对话',
        '不设主席台，只摆一圈椅子——记一次沙龙'
      ],
      scene: [
        '咖啡馆式的座位被摆成一圈，桌上放着便签与彩笔，{place}在开场前就被布置成一个适合聊天的地方',
        '签到台旁立着一块写满问题便利贴的白板，同学到场后先认领一个自己想说的话题',
        '没有主席台，也没有长篇介绍，主持人用一句“今天没有标准答案”把气氛放松下来'
      ],
      comment: '话题从“最近在忙什么”自然滑向“想成为什么样的人”，中间没有冷场，只有不断被递过来的话筒',
      plan: [
        { name: '自由入场', desc: '同学陆续到场，认领话题便签，自由取用茶点' },
        { name: '破冰开场', desc: '主持人用两个问题破冰，介绍沙龙规则' },
        { name: '话题对谈', desc: '围绕核心话题分组讨论，每组推选代表分享观点' },
        { name: '自由交流', desc: '跨组自由交流，交换联系方式，形成后续连接' },
        { name: '收尾', desc: '主持人总结关键词，收集反馈便签并合影' }
      ],
      quotes: [
        { who: '一位坐在角落的大三同学', text: '原本只想听听，结果被问到“你最近在为什么事纠结”，话匣子一下就打开了' },
        { who: '主持人', text: '沙龙最好的状态是没有人看手机，今天大概做到了' }
      ],
      highlights: [
        '**氛围松弛**：没有主席台和长发言，{actual}名同学围坐交流，{groupCount}个小组各自形成话题',
        '**话题真实**：讨论从学业规划延伸到人际关系，现场收集问题便签{noteCount}张',
        '**连接延续**：活动后建立交流群，一周内仍有同学在群里继续讨论',
        '**成本可控**：场地与茶点合计支出{expense}元，人均成本不高但体验评价较好'
      ],
      problems: [
        '分组讨论缺少引导，个别小组话题很快跑偏，需要更明确的讨论提纲（来源：现场观察）',
        '场地声学条件一般，两组同时发言时相互干扰（来源：参与者反馈）',
        '反馈收集依赖纸质便签，整理成本高，建议改为线上问卷（来源：筹备复盘）'
      ],
      next: [
        '把沙龙做成月度栏目，每期确定一个真实困扰作为主题',
        '为每组配备引导员与讨论提纲，让对话更聚焦'
      ]
    },

    team: {
      key: 'team', label: '团建', verb: '举办', noun: '团建活动', genre: '团建',
      form: '分组任务与协作挑战', theme: '在协作里重新认识彼此',
      audience: '社团全体成员',
      goal: '在协作任务中建立信任，为下一阶段工作打底',
      title: [
        '{name}：{actual}名成员用一天时间重新认识彼此',
        '从陌生到默契：记{name}',
        '{name}侧记：把「{theme}」练成肌肉记忆'
      ],
      subtitle: [
        '以「{theme}」为目标，{org}用分组任务完成一次团队热身',
        '这一天不谈工作，只谈合作——记一次团建'
      ],
      scene: [
        '抵达{place}后，{actual}名成员被随机分成{groupCount}组，队旗与号码牌在十分钟内发到每个人手上',
        '教练先带大家做了两轮破冰，原本不熟的成员很快记住了彼此的昵称',
        '场地边支起了物资桌，水、药品与备用雨衣按组摆放，安全员逐个检查装备'
      ],
      comment: '在最后一个协作项目里，各组不约而同地把“沟通”写进了复盘关键词，输赢反而被放在了后面',
      plan: [
        { name: '集合出发', desc: '成员集合签到，领取队服与号码牌，随机分组' },
        { name: '破冰热身', desc: '教练带领破冰游戏，各组确定队名、口号与分工' },
        { name: '协作挑战', desc: '依次完成协作挑战项目，按完成度累计积分' },
        { name: '复盘分享', desc: '各组复盘协作过程，分享“最想感谢的人”' },
        { name: '总结与合影', desc: '公布积分、颁发纪念品，全体合影' }
      ],
      quotes: [
        { who: '一位新加入的成员', text: '原来只在群里见过名字，今天终于把人和名字对上了' },
        { who: '活动负责人', text: '团建不是为了赢，是为了让下次赶工的时候，大家愿意多等彼此十分钟' }
      ],
      highlights: [
        '**分组随机**：{actual}名成员随机分成{groupCount}组，打破原有部门壁垒',
        '**任务递进**：项目从破冰到协作再到复盘，难度与信任要求逐级提升',
        '**安全兜底**：配备随队安全员与药品，出发前完成风险提示与紧急联络人登记',
        '**复盘有产出**：各组形成协作改进建议{n}条，已纳入社团例会讨论'
      ],
      problems: [
        '行程偏紧，破冰环节被压缩，部分新成员还没记住同伴名字就进入挑战（来源：现场观察）',
        '挑战项目对体能要求偏高，个别成员只能旁观，参与感有落差（来源：成员反馈）',
        '费用以AA与社团补贴混合承担，报销口径事前说明不够清楚（来源：财务复盘）'
      ],
      next: [
        '把团建中的协作规则写进社团工作手册，例会沿用',
        '每学期安排一次轻量团建，降低参与门槛，提高出勤率'
      ]
    },

    recruit: {
      key: 'recruit', label: '招新', verb: '举办', noun: '招新活动', genre: '招新',
      form: '摊位展示与现场体验', theme: '让热爱找到组织',
      audience: '全体新生及有兴趣加入的同学',
      goal: '让对的人看见我们，也让老成员重新讲清自己为什么在这里',
      title: [
        '{name}：{actual}名同学在摊位前停下脚步',
        '让热爱找到组织：记{name}',
        '{name}收官：{signup}人报名，{actual}人到场体验'
      ],
      subtitle: [
        '以「{theme}」为口号，{org}用一天时间完成一次纳新',
        '摊位、作品与一杯热茶——记一次招新'
      ],
      scene: [
        '招新摊位在{place}一字排开，易拉宝、摊位灯与体验设备让路过的同学纷纷停下脚步',
        '负责签到的同学手里攥着报名二维码，一上午就加满了两个咨询群',
        '摊位前摆着社团往期作品与荣誉证书，几位老成员现场演示，吸引了不少新生排队体验'
      ],
      comment: '一整天下来，咨询群里的问题从“零基础能不能来”到“每周要投入多少时间”，负责答疑的成员几乎没有停过打字',
      plan: [
        { name: '布展准备', desc: '提前到场布置摊位、易拉宝、作品展台与体验设备' },
        { name: '现场咨询', desc: '值班成员介绍社团定位、活动频率与加入方式，答疑并登记' },
        { name: '体验互动', desc: '设置体验环节，让同学现场动手感受社团日常' },
        { name: '面谈与确认', desc: '现场或后续安排面谈，确认意向并拉入新人群' },
        { name: '收尾', desc: '清点物料与报名表，整理意向名单，合影' }
      ],
      quotes: [
        { who: '一位刚填完表的新生', text: '我本来只是路过，看到学长现场演示才决定报名' },
        { who: '招新负责人', text: '我们今年不追求报名数字，更在意来的人是不是真的想做事' }
      ],
      highlights: [
        '**展示直观**：摊位设置作品展台与现场体验，{actual}名同学参与体验后留下联系方式',
        '**分工明确**：{staffCount}名成员分咨询、体验、登记、机动四组，高峰期也能有序接待',
        '**转化可见**：现场登记{signup}人，活动后一周内确认加入{n}人',
        '**物料可复用**：易拉宝与展示物料统一设计，可在后续活动中重复使用'
      ],
      problems: [
        '摊位位置与动线不佳，部分时段人流集中在相邻社团，接待量不均（来源：现场观察）',
        '体验设备数量有限，高峰期需要排队，部分同学没等到就离开（来源：现场记录）',
        '报名信息只收了手机号，后续分群与通知效率低（来源：招新复盘）'
      ],
      next: [
        '固定每年两次招新节奏，提前一个月启动物料与宣传准备',
        '优化报名表字段，增加意向方向与可投入时间，便于分组培养'
      ]
    },

    training: {
      key: 'training', label: '培训', verb: '开班', noun: '培训', genre: '培训',
      form: '讲授与实操练习', theme: '把技能练到能用',
      audience: '希望补齐技能短板的同学',
      goal: '让同学在有限时间里完成从“听懂”到“做出来”的跨越',
      title: [
        '{name}开班：{actual}名同学用{hours}小时完成一次技能进阶',
        '从听懂到做出来：记{name}',
        '{name}侧记：{exerciseCount}道练习题的实战课'
      ],
      subtitle: [
        '围绕「{theme}」，{org}把培训做成了一次动手课',
        '讲一半、练一半——记一次技能培训'
      ],
      scene: [
        '培训开始前，工作人员已经把电脑和大屏调试了三遍，备用电源、充电线按座位号分好',
        '签到台为每位学员发放讲义与练习素材，{place}的座位按小组围成数个方阵，方便随时讨论',
        '大屏上滚动着课程目录，早到的同学已经打开示例文件跟着预习'
      ],
      comment: '练习环节，讲师逐组巡看，遇到卡住的学员就坐下来一起改，直到流程跑通为止',
      plan: [
        { name: '签到与准备', desc: '学员签到、领取讲义与练习素材，按小组就座' },
        { name: '讲授环节', desc: '讲师围绕核心知识点讲解，配合现场演示' },
        { name: '实操练习', desc: '学员按练习材料动手操作，助教逐组答疑' },
        { name: '成果点评', desc: '展示优秀练习，讲师点评共性问题' },
        { name: '总结与答疑', desc: '回收问卷、布置课后任务，合影' }
      ],
      quotes: [
        { who: '一位零基础学员', text: '第一次自己把流程跑通的时候，比听完十页讲义都有成就感' },
        { who: '助教', text: '问题集中在同样的三个地方，下一期可以把这三个点前置讲透' }
      ],
      highlights: [
        '**讲练结合**：讲授与实操比例约一比一，{actual}名学员全部完成基础练习',
        '**助教到位**：{staffCount}名助教按小组包干，平均响应时间控制在两分钟内',
        '**材料可复用**：讲义、练习与录屏已整理归档，可作为下一期的标准教材',
        '**反馈具体**：课后问卷回收{n}份，学员对“实操占比”的满意度最高'
      ],
      problems: [
        '学员基础差异较大，统一进度让部分同学觉得偏慢、部分同学跟不上（来源：课后问卷）',
        '练习环境准备不足，个别电脑环境配置出错，占用了练习时间（来源：助教记录）',
        '课后任务缺少跟踪，完成情况无法统计（来源：筹备复盘）'
      ],
      next: [
        '按基础分层开设入门班与进阶班，练习材料提前分级',
        '建立课后任务打卡与答疑机制，把学习延伸到培训之外'
      ]
    },

    exhibition: {
      key: 'exhibition', label: '展览', verb: '开幕', noun: '展览', genre: '展览',
      form: '作品陈列与导览讲解', theme: '让作品被看见，也让过程被看见',
      audience: '全校师生',
      goal: '用一次公开展览，把创作过程与成果同时呈现出来',
      title: [
        '{name}开幕：{actual}件作品讲述「{theme}」',
        '在展墙前停下的人：记{name}',
        '{name}侧记：一场把过程也展出来的展览'
      ],
      subtitle: [
        '以「{theme}」为主题，{org}把创作的手稿与成品一起挂上墙',
        '从草稿到成品，一次关于“如何做出来”的公开展示'
      ],
      scene: [
        '{place}的展墙在活动前一天完成布展，导览路线用地面箭头与灯带标示得清清楚楚',
        '开幕前，工作人员逐幅检查展签与作品说明，志愿者在入口处准备了讲解设备',
        '留言墙上很快贴满了便签，有同学蹲下来认真写下对作品的感受'
      ],
      comment: '不少观众在作品前停留超过五分钟，有人拍照，有人把细节记进手机备忘录，留言墙的便签一下午就补了两次',
      plan: [
        { name: '布展', desc: '提前一天完成展墙搭建、作品悬挂与展签核对' },
        { name: '开幕导览', desc: '负责人介绍策展思路，导览员带队讲解重点作品' },
        { name: '自由观展', desc: '观众自由参观，参与留言墙与投票互动' },
        { name: '分享会', desc: '作者代表分享创作过程，回应观众提问' },
        { name: '撤展与归档', desc: '清点作品、撤展并完成影像归档' }
      ],
      quotes: [
        { who: '一位在展墙前停留很久的观众', text: '以前只看得到成品，这次能看到草稿和修改痕迹，反而更打动我' },
        { who: '参展作者', text: '作品挂上墙的那一刻，才真正觉得它完成了' }
      ],
      highlights: [
        '**过程可见**：展陈同时呈现草稿、过程稿与成品，{actual}件作品完整讲述创作链路',
        '**导览有效**：安排{n}场定时导览，观众平均停留时间超过十五分钟',
        '**互动充分**：留言墙收集便签{noteCount}张，现场投票选出最受欢迎作品',
        '**归档规范**：作品与展陈影像全部归档，形成可复用的线上展览素材'
      ],
      problems: [
        '展签信息偏简，部分观众看不懂作品背景，需要补充二维码说明（来源：观众反馈）',
        '展期偏短，工作日观展人数明显少于周末（来源：签到统计）',
        '灯光与展墙高度对部分作品不友好，反光影响观看（来源：布展记录）'
      ],
      next: [
        '把展览搬到线上，形成长期可访问的数字展厅',
        '延长展期并增加夜场，配套策展人讲解'
      ]
    },

    other: {
      key: 'other', label: '活动', verb: '举办', noun: '活动', genre: '活动',
      form: '主题分享与互动交流', theme: '把想法变成一次真实的相聚',
      audience: '有兴趣参与的同学',
      goal: '用一次完整的活动，把想法落地成可被感知的体验',
      title: [
        '{name}举办：{actual}名同学共同完成一次相聚',
        '记{name}：一次把想法落地的尝试',
        '{name}侧记：{stepCount}个环节，{actual}人到场'
      ],
      subtitle: [
        '以「{theme}」为线索，{org}完成了一次从策划到复盘的完整实践',
        '从筹备到散场，记录一场活动的全部细节'
      ],
      scene: [
        '活动开始前，{place}已经完成布置，签到台、指引牌与物料按流程表各就各位',
        '工作人员在开场前二十分钟做了最后一次走场，把每一页演示文稿与话筒音量逐个确认',
        '同学陆续到场，签到台前的队伍秩序井然，负责引导的同学把大家带到指定区域'
      ],
      comment: '各环节衔接顺畅，工作人员在流程表上逐项打勾，遇到临时调整也能在几分钟内重新分工',
      plan: [
        { name: '签到入场', desc: '工作人员核验报名信息、发放资料，引导同学入场' },
        { name: '开场介绍', desc: '主持人介绍活动背景、到场嘉宾与流程安排' },
        { name: '主题环节', desc: '按策划方案开展主题分享或体验环节' },
        { name: '互动交流', desc: '现场互动、答疑与自由交流' },
        { name: '总结合影', desc: '负责人总结、致谢并合影留念' }
      ],
      quotes: [
        { who: '一位参与同学', text: '本来只是来看看，结果全程都在参与，结束还和旁边的同学加了微信' },
        { who: '活动负责人', text: '把计划表上的每一行变成现场的一分钟，是这次最大的收获' }
      ],
      highlights: [
        '**筹备有序**：活动前{prepDays}天完成方案与预算定稿，流程表精确到每个环节的负责人',
        '**执行到位**：{stepCount}个环节按计划推进，{staffCount}名工作人员分四组协同',
        '**参与真实**：{actual}名同学到场，互动环节提问与体验的参与度较高',
        '**复盘留痕**：报名、签到与问卷数据完整留存，形成可复用的复盘材料'
      ],
      problems: [
        '宣传启动偏晚，报名高峰集中在活动前两天（来源：筹备复盘）',
        '现场引导标识不够醒目，部分同学在入口处短暂停留（来源：现场观察）',
        '环节之间的转场时间估计不足，整体节奏前松后紧（来源：流程记录）'
      ],
      next: [
        '把本次活动沉淀为可复用的执行模板，供下一次活动直接调用',
        '围绕参与者反馈优化环节设计，形成每学期固定档期'
      ]
    }
  };

  /** 类型别名；类型字段优先级最高，名称只在无类型或类型无法识别时做保守推断 */
  var TYPE_ALIASES = [
    ['lecture', ['讲座', '学术讲座', '分享会', '报告会', 'lecture', 'talk', 'seminar', '读书会']],
    ['contest', ['比赛', '竞赛', '大赛', '挑战赛', '赛事', 'contest', 'competition', 'race', 'hackathon', '马拉松']],
    ['performance', ['演出', '晚会', '音乐会', '展演', '话剧', 'performance', 'show', 'gala']],
    ['volunteer', ['志愿', '公益', '服务', 'volunteer']],
    ['salon', ['沙龙', 'salon', '座谈', '对谈']],
    ['team', ['团建', '素拓', '拓展', 'team building', 'team']],
    ['recruit', ['招新', '纳新', '招干', 'recruit']],
    ['training', ['培训', '课程', '训练营', '工作坊', 'training', 'workshop', '开班']],
    ['exhibition', ['展览', '展出', '画展', '作品展', '展陈', 'exhibition']]
  ];

  /** 名称里出现这些明确的类型词时，才允许在 type 缺省时推断，否则默认「活动」 */
  var TYPE_NAME_HINTS = [
    ['contest', ['比赛', '竞赛', '大赛', '挑战赛', '杯赛', '马拉松']],
    ['performance', ['演出', '晚会', '音乐会', '话剧', '展演']],
    ['volunteer', ['志愿服务', '志愿活动', '公益活动']],
    ['lecture', ['讲座', '讲坛', '报告会']],
    ['salon', ['沙龙', '座谈', '对谈']],
    ['team', ['团建', '素拓', '拓展训练']],
    ['recruit', ['招新', '纳新']],
    ['training', ['培训', '训练营', '工作坊']],
    ['exhibition', ['展览', '画展', '作品展']]
  ];

  function matchByAlias(text) {
    var t = s(text).toLowerCase(), i, j;
    for (i = 0; i < TYPE_ALIASES.length; i++) {
      for (j = 0; j < TYPE_ALIASES[i][1].length; j++) {
        if (t.indexOf(TYPE_ALIASES[i][1][j].toLowerCase()) >= 0) return TYPES[TYPE_ALIASES[i][0]];
      }
    }
    return null;
  }

  /** 类型归一：type 字段优先；缺省/未知时保守推断；仍无法判断则默认「活动」 */
  function normalizeType(raw, name) {
    var matched = matchByAlias(raw);
    if (matched) return matched;
    var t = s(name).toLowerCase(), i, j;
    for (i = 0; i < TYPE_NAME_HINTS.length; i++) {
      for (j = 0; j < TYPE_NAME_HINTS[i][1].length; j++) {
        if (t.indexOf(TYPE_NAME_HINTS[i][1][j].toLowerCase()) >= 0) return TYPES[TYPE_NAME_HINTS[i][0]];
      }
    }
    return TYPES.other;
  }

  /* =======================================================================
   * 2. 日期与时间
   * ===================================================================== */

  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /** 解析日期：支持 2026-05-20 / 2026/5/20 / 2026年5月20日 / 5月20日 */
  function parseDate(raw) {
    var t = s(raw);
    var out = { ok: false, full: '', short: '', week: '', month: 0, day: 0, year: 0 };
    if (!t) return out;
    var m = t.match(/(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/);
    if (m) {
      out.year = parseInt(m[1], 10);
      out.month = parseInt(m[2], 10);
      out.day = parseInt(m[3], 10);
    } else {
      var m2 = t.match(/(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/);
      if (!m2) return out;
      out.month = parseInt(m2[1], 10);
      out.day = parseInt(m2[2], 10);
    }
    if (out.month < 1 || out.month > 12 || out.day < 1 || out.day > 31) return out;
    out.ok = true;
    out.short = out.month + '月' + out.day + '日';
    if (out.year) {
      out.full = out.year + '年' + out.month + '月' + out.day + '日';
      out.week = WEEK[new Date(Date.UTC(out.year, out.month - 1, out.day)).getUTCDay()];
    } else {
      out.full = out.short;
    }
    return out;
  }

  /** 解析 HH:MM → 分钟 */
  function parseHM(v) {
    var m = s(v).match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  /** 分钟 → HH:MM */
  function fmtHM(minutes) {
    var m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mi = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
  }

  /* =======================================================================
   * 3. 输入归一化
   * ===================================================================== */

  /** 流程步骤归一：支持 [{time,content}]、文本、混合数组 */
  function normProcess(raw) {
    var out = [];
    function parseLine(line) {
      var t = s(line);
      if (!t) return;
      var m = t.match(/^(\d{1,2}\s*[:：]\s*\d{2})\s*[、,，.．:：\-—~～|]?\s*(.+)$/);
      if (m) out.push({ time: s(m[1]).replace(/\s+/g, ''), content: s(m[2]) });
      else out.push({ time: '', content: t });
    }
    if (Object.prototype.toString.call(raw) === '[object Array]') {
      raw.forEach(function (it) {
        if (it && typeof it === 'object') {
          var content = s(it.content || it.text || it.desc || it.name || it.title);
          var time = s(it.time || it.t || it.start || '');
          if (content) out.push({ time: time.replace(/\s+/g, ''), content: content });
        } else {
          parseLine(it);
        }
      });
    } else if (s(raw)) {
      s(raw).split(/[\n\r]+/).forEach(parseLine);
    }
    return out;
  }

  /** 引语归一：支持 [{who,text}]、'{who}：{text}' 文本 */
  function normQuotes(raw) {
    var out = [];
    function parseLine(line) {
      var t = s(line).replace(/^[“"「]/, '');
      if (!t) return;
      var m = t.match(/^(.{1,24}?)\s*[：:]\s*(.+)$/);
      if (m) out.push({ who: s(m[1]).replace(/[“”"「」]/g, ''), text: s(m[2]).replace(/[”"」]$/, '') });
      else out.push({ who: '', text: t.replace(/[”"」]$/, '') });
    }
    if (Object.prototype.toString.call(raw) === '[object Array]') {
      raw.forEach(function (it) {
        if (it && typeof it === 'object') {
          var text = s(it.text || it.quote || it.content || it.say);
          if (text) out.push({ who: s(it.who || it.name || it.from || ''), text: stripEnd(text) });
        } else {
          parseLine(it);
        }
      });
    } else if (s(raw)) {
      s(raw).split(/[\n\r]+/).forEach(parseLine);
    }
    return out;
  }

  /** 奖项归一 */
  function normAwards(raw) {
    var list = toSentences(raw);
    if (!list.length) {
      return { list: [], count: 0, short: '各奖项花落有主', text: '各奖项依次揭晓' };
    }
    var heads = [];
    list.forEach(function (item) {
      var h = s(item).replace(/[\d０-９]+.*$/, '').replace(/[（(].*$/, '');
      h = s(h) || s(item).replace(/^\d+[、.．]/, '').slice(0, 6);
      if (h && heads.indexOf(h) < 0) heads.push(h);
    });
    var short = heads.length >= 2 ? '各奖项花落有主' : (heads[0] ? heads[0] + '揭晓' : '各奖项花落有主');
    return { list: list, count: list.length, short: short, text: list.join('、') };
  }

  /* =======================================================================
   * 4. 统计结果防御式读取
   * ===================================================================== */

  function readStats(stats) {
    var r = {
      ok: false, totals: {}, sources: [], roster: [], distributions: [],
      trend: [], fee: null, insights: [], warnings: [], unmatched: []
    };
    if (!stats || typeof stats !== 'object') return r;
    r.ok = true;
    r.totals = stats.totals && typeof stats.totals === 'object' ? stats.totals : {};
    r.sources = Object.prototype.toString.call(stats.sources) === '[object Array]' ? stats.sources : [];
    r.roster = Object.prototype.toString.call(stats.roster) === '[object Array]' ? stats.roster : [];
    r.distributions = Object.prototype.toString.call(stats.distributions) === '[object Array]' ? stats.distributions : [];
    r.trend = Object.prototype.toString.call(stats.trend) === '[object Array]' ? stats.trend : [];
    r.fee = stats.fee && typeof stats.fee === 'object' ? stats.fee : null;
    r.insights = Object.prototype.toString.call(stats.insights) === '[object Array]'
      ? stats.insights.map(s).filter(Boolean) : [];
    r.warnings = Object.prototype.toString.call(stats.warnings) === '[object Array]'
      ? stats.warnings.map(s).filter(Boolean) : [];
    r.unmatched = Object.prototype.toString.call(stats.unmatched) === '[object Array]' ? stats.unmatched : [];
    return r;
  }

  function distOf(st, field) {
    var i;
    for (i = 0; i < st.distributions.length; i++) {
      if (st.distributions[i] && st.distributions[i].field === field) return st.distributions[i];
    }
    return null;
  }

  function distItems(d) {
    return d && Object.prototype.toString.call(d.items) === '[object Array]' ? d.items : [];
  }

  /* =======================================================================
   * 5. 上下文与指标推导
   * ===================================================================== */

  /** 从 feedback 自由文本里解析问卷份数与满意度（4.8/5、96%、满意率 95% 等写法） */
  function parseFeedback(text) {
    var t = s(text);
    var out = { surveyCount: null, satisfaction: null };
    if (!t) return out;
    var m = t.match(/(?:回收|收到|共收到|有效)?\s*问卷\s*(\d{1,5})\s*份/) || t.match(/(\d{1,5})\s*份(?:有效)?问卷/);
    if (m) out.surveyCount = parseInt(m[1], 10);
    var p = t.match(/(?:满意度|满意率|满意及以上)[^\d]{0,8}(\d{1,3}(?:\.\d+)?)\s*%/);
    if (p) {
      out.satisfaction = Math.max(0, Math.min(100, round(parseFloat(p[1]), 1)));
    } else {
      var sc = t.match(/(?:满意度|满意率|平均分|评分)[^\d]{0,8}(\d(?:\.\d+)?)\s*(?:\/\s*(5|10)|分)/);
      if (sc) {
        var v = parseFloat(sc[1]);
        var base = sc[2] ? Number(sc[2]) : 5;
        if (base > 0) out.satisfaction = Math.max(0, Math.min(100, round((v / base) * 100, 1)));
      }
    }
    return out;
  }

  /** 构造写作上下文（含全部衍生的确定性数据） */
  function buildContext(input) {
    var raw = input && typeof input === 'object' ? input : {};
    var T = normalizeType(raw.type, raw.name);
    var h = hash(s(raw.name) + '|' + s(raw.date) + '|' + s(raw.place));

    var name = s(raw.name) || '社团主题活动';
    var org = s(raw.org) || '校学生社团联合会';
    var place = s(raw.place) || '学校大学生活动中心';
    // theme 未提供时用活动名称本身，绝不编造主题口号
    var themeProvided = !!s(raw.theme);
    var theme = s(raw.theme) || name;
    var audience = s(raw.audience) || '全校同学';

    var d = parseDate(raw.date);
    var dateFull = d.ok ? (d.full + (d.week ? '（' + d.week + '）' : '')) : '待定（以实际通知为准）';
    var dateShort = d.ok ? d.short : '近日';

    var startMin = parseHM(raw.timeStart);
    var endMin = parseHM(raw.timeEnd);
    if (startMin === null) startMin = 19 * 60;
    if (endMin === null) endMin = startMin + 120;
    if (endMin <= startMin) endMin = startMin + 120;
    if (endMin - startMin > 12 * 60) endMin = startMin + 12 * 60;
    var timeStart = fmtHM(startMin);
    var timeEnd = fmtHM(endMin);
    var durationMin = endMin - startMin;
    var hours = round(durationMin / 60, 1);
    var hoursText = (hours % 1 === 0 ? String(hours) : hours.toFixed(1)) + '小时';

    var guests = toList(raw.guests);
    var awards = normAwards(raw.awards);
    var feedback = s(raw.feedback);
    var fb = parseFeedback(feedback);
    var highlights = toSentences(raw.highlights);
    var issues = toSentences(raw.issues);
    var improvements = toSentences(raw.improvements);
    var quotes = normQuotes(raw.quotes);
    var process = normProcess(raw.process);
    var st = readStats(raw.stats);

    /* ---- 人数与到场率：实到 ≤ 报名，计划规模只取自输入，不反推 ---- */
    var scale = n(raw.scale, n(raw.expectCount, null));
    var signupFromStats = false;
    var signup = n(raw.signupCount, null);
    if ((signup === null || signup <= 0) && st.ok) {
      var db = n(st.totals.unique, null);
      if (db === null) db = n(st.totals.raw, null);
      if (db === null && st.roster.length) db = st.roster.length;
      if (db !== null && db > 0) { signup = db; signupFromStats = true; }
    }
    if (signup === null || signup <= 0) signup = scale !== null && scale > 0 ? scale : 120;
    if (scale === null || scale <= 0) scale = signup;
    var actual = n(raw.actualCount, null);
    if (actual === null) actual = Math.round(Math.min(scale, signup) * 0.93);
    if (actual > signup) actual = signup;
    if (actual < 0) actual = 0;
    var rate = signup > 0 ? round((actual / signup) * 100, 1) : 0;
    // 未导入报名表、也没手填人数时，人数来自「按计划规模估算」，文档里必须标注
    var signupEstimated = !signupFromStats && n(raw.signupCount, null) === null;
    var actualEstimated = n(raw.actualCount, null) === null;

    /* ---- 统计衍生指标 ---- */
    var collegeDist = distOf(st, 'college');
    var collegeItems = distItems(collegeDist);
    var collegeCount = collegeItems.length;
    var topCollege = collegeItems.length ? s(collegeItems[0].label) : '';
    var topCollegeCount = collegeItems.length ? n(collegeItems[0].count, 0) : 0;
    var memberDist = distOf(st, 'isMember');
    var memberItems = distItems(memberDist);
    var memberPct = 0, memberKnown = false;
    memberItems.forEach(function (it) {
      if (s(it.label) === '是') { memberPct = n(it.pct, 0); memberKnown = true; }
    });
    var gradeDist = distOf(st, 'grade');
    var gradeItems = distItems(gradeDist);
    var completeRate = st.ok ? n(st.totals.completeRate, 0) : 0;
    var completeKnown = st.ok && n(st.totals.completeRate, null) !== null;
    var peakDay = '', peakCount = 0;
    st.trend.forEach(function (it) {
      var c = n(it && it.count, 0);
      if (c > peakCount) { peakCount = c; peakDay = s(it && it.date); }
    });

    var satisfactionKnown = n(raw.satisfaction, null) !== null || n(raw.satisfactionPct, null) !== null || fb.satisfaction !== null;
    var satisfaction = n(raw.satisfaction, n(raw.satisfactionPct, fb.satisfaction));
    if (satisfaction !== null) satisfaction = Math.max(0, Math.min(100, satisfaction));
    var surveyCount = n(raw.surveyCount, fb.surveyCount);
    var surveyKnown = surveyCount !== null;
    var reach = n(raw.reach, n(raw.readCount, null));
    var reachKnown = reach !== null;
    var photos = n(raw.photos, null);
    var photosKnown = photos !== null;

    var collegeKnown = collegeItems.length > 0;

    /* ---- 费用 ---- */
    var budgetPlan = n(raw.budgetPlan, n(raw.budget, null));
    var budgetActual = n(raw.budgetActual, n(raw.actualBudget, n(raw.cost, null)));
    if ((budgetPlan === null || budgetPlan <= 0) && st.fee) {
      var feeAmount = n(st.fee.amount, 0);
      if (feeAmount > 0) budgetActual = budgetActual === null ? feeAmount : budgetActual;
    }
    if (budgetPlan === null || budgetPlan <= 0) {
      var perPerson = { lecture: 12, contest: 45, performance: 35, volunteer: 15, salon: 20, team: 60, recruit: 12, training: 20, exhibition: 28, other: 25 }[T.key];
      budgetPlan = Math.max(300, Math.round((actual || scale) * perPerson / 100) * 100);
    }
    if (budgetActual === null || budgetActual <= 0) {
      var ratio = 0.86 + ((h % 9) / 100); // 0.86 ~ 0.94，确定性
      budgetActual = Math.round(budgetPlan * ratio / 10) * 10;
    }
    budgetPlan = Math.round(budgetPlan);
    budgetActual = Math.round(budgetActual);

    /* ---- 派生展示数字（与人数自洽） ---- */
    var teamCount = n(raw.teamCount, null);
    if (teamCount === null) teamCount = Math.max(4, Math.round(actual / 4));
    var programCount = n(raw.programCount, null);
    if (programCount === null) programCount = 8 + (h % 5);
    var groupCount = Math.max(3, Math.min(8, Math.round(actual / 8) || 3));
    var staffCount = Math.max(6, Math.min(30, Math.round(actual / 9)));
    var questionCount = 6 + (h % 6);
    var workCount = Math.max(teamCount, 6 + (h % 6));
    var awardCount = awards.count || 4 + (h % 3);
    var finalistCount = Math.max(3, Math.min(6, Math.round(teamCount / 3)));
    var taskCount = 3 + (h % 3);
    var noteCount = 20 + (h % 30);
    var exerciseCount = 4 + (h % 4);
    var prepDays = 10 + (h % 8);
    var originalCount = Math.max(2, Math.round(programCount * 0.6));
    var exhibitDays = 3 + (h % 4);
    var nSmall = 3 + (h % 3);

    /* ---- 流程：缺省时按类型生成，并按 timeStart~timeEnd 推算时刻 ---- */
    var stepSource = process.length ? process : T.plan;
    var steps = [];
    stepSource.forEach(function (step, idx) {
      var time = s(step.time).replace(/\s+/g, '');
      var content = s(step.content || step.desc || step.name);
      if (step.desc && !step.content) content = s(step.name) + '：' + s(step.desc);
      var minutes = parseHM(time);
      if (time && minutes !== null) time = fmtHM(minutes);
      if (!time || minutes === null) {
        time = fmtHM(startMin + Math.round(durationMin * (idx / Math.max(1, stepSource.length - 1)) * 0.92));
      }
      steps.push({ time: time, content: content });
    });

    var guestClause = guests.length ? guests[0] + '等到场，' : '';

    var ctx = {
      input: raw, T: T, stats: st, name: name, org: org, place: place, theme: theme,
      themeProvided: themeProvided, audience: audience, audienceText: s(raw.audience) || T.audience,
      date: s(raw.date), dateFull: dateFull, dateShort: dateShort, week: d.week,
      timeStart: timeStart, timeEnd: timeEnd, durationMin: durationMin,
      hours: hoursText, hoursText: hoursText, hoursNum: hours,
      scale: scale, signup: signup, actual: actual, rate: rate,
      signupEstimated: signupEstimated, actualEstimated: actualEstimated,
      satisfaction: satisfaction, satisfactionKnown: satisfactionKnown, surveyCount: surveyCount,
      surveyKnown: surveyKnown, reach: reach, reachKnown: reachKnown,
      photos: photos, photosKnown: photosKnown,
      collegeCount: collegeCount, collegeKnown: collegeKnown, collegeItems: collegeItems,
      topCollege: topCollege, topCollegeCount: topCollegeCount,
      memberPct: memberPct, memberKnown: memberKnown,
      gradeItems: gradeItems, gradeDist: gradeDist,
      completeRate: completeRate, completeKnown: completeKnown,
      peakDay: peakDay, peakCount: peakCount,
      guests: guests, guestClause: guestClause, awards: awards,
      feedback: feedback, highlights: highlights, issues: issues, improvements: improvements,
      quotes: quotes, process: steps, stepCount: steps.length,
      // 署名约定（与 app.js 集成一致）：contactName=供稿人，contactPhone=摄影署名
      contactName: s(raw.contactName) || org,
      contactPhone: s(raw.contactPhone) || (org + '摄影组'),
      contributor: s(raw.contactName) || org,
      photographer: s(raw.contactPhone) || (org + '摄影组'),
      reviewer: org,
      budgetPlan: budgetPlan, budgetActual: budgetActual,
      teamCount: teamCount, programCount: programCount, groupCount: groupCount,
      staffCount: staffCount, questionCount: questionCount, workCount: workCount,
      awardCount: awardCount, finalistCount: finalistCount, taskCount: taskCount,
      noteCount: noteCount, exerciseCount: exerciseCount, prepDays: prepDays,
      originalCount: originalCount, exhibitDays: exhibitDays, n: nSmall,
      seed: h
    };
    ctx.vars = buildVars(ctx);
    return ctx;
  }

  /** 模板变量表 */
  function buildVars(ctx) {
    return {
      name: ctx.name, org: ctx.org, place: ctx.place, theme: ctx.theme,
      date: ctx.date, dateShort: ctx.dateShort, dateFull: ctx.dateFull,
      scale: ctx.scale, signup: ctx.signup, actual: ctx.actual, rate: ctx.rate,
      sat: ctx.satisfaction, reach: ctx.reach, hours: ctx.hoursNum,
      hoursText: ctx.hours, stepCount: ctx.stepCount, teamCount: ctx.teamCount,
      awardShort: ctx.awards.short, programCount: ctx.programCount,
      guestClause: ctx.guestClause, collegeCount: ctx.collegeCount,
      completeRate: ctx.completeRate, contactName: ctx.contactName,
      expense: yuan(ctx.budgetActual), groupCount: ctx.groupCount,
      noteCount: ctx.noteCount, staffCount: ctx.staffCount,
      questionCount: ctx.questionCount, workCount: ctx.workCount,
      awardCount: ctx.awardCount, finalistCount: ctx.finalistCount,
      taskCount: ctx.taskCount, exhibitDays: ctx.exhibitDays,
      exerciseCount: ctx.exerciseCount, prepDays: ctx.prepDays,
      n: ctx.n, typeNoun: ctx.T.noun, genre: ctx.T.genre
    };
  }

  /* =======================================================================
   * 6. 新闻稿
   * ===================================================================== */

  /** 导语（一句话交代 5W；主题为空时不编造话题，只写可核实的事实） */
  function leadSentence(ctx) {
    var date = ctx.dateShort, org = ctx.org, name = ctx.name, place = ctx.place;
    var guest = ctx.guestClause, actual = ctx.actual, hours = ctx.hoursText;
    var hasTheme = ctx.themeProvided;
    switch (ctx.T.key) {
      case 'lecture':
        return date + '，由' + org + '主办的「' + name + '」在' + place + '开讲，' + guest + actual + '名同学到场，' +
          (hasTheme ? '围绕「' + ctx.theme + '」交流了约' + hours : '整场交流持续约' + hours) + '，现场座无虚席。';
      case 'contest':
        return date + '，' + org + '主办的「' + name + '」在' + place + '落下帷幕，' + guest +
          (ctx.teamCount ? ctx.teamCount + '支队伍、' : '') + actual + '名选手同场竞技，' + ctx.awards.short + '。';
      case 'performance':
        return date + '，' + org + '主办的「' + name + '」在' + place + '上演，' + guest + actual + '名同学用' +
          ctx.programCount + '个节目' + (hasTheme ? '呈现了「' + ctx.theme + '」' : '把排练室里的坚持带上了舞台') + '。';
      case 'volunteer':
        return date + '，' + org + '组织的「' + name + '」在' + place + '开展，' + guest + actual + '名志愿者用' +
          hours + '完成了一组具体的服务' + (hasTheme ? '，围绕「' + ctx.theme + '」把想法变成了行动' : '') + '。';
      case 'salon':
        return date + '，' + org + '在' + place + '举办「' + name + '」，' + guest + actual + '名同学围坐一起聊了整整' +
          hours + (hasTheme ? '，话题围绕「' + ctx.theme + '」展开' : '') + '，没有人提前离场。';
      case 'team':
        return date + '，' + org + '在' + place + '举办「' + name + '」，' + guest + actual + '名成员在' +
          ctx.stepCount + '个协作环节里完成了一次真实的配合' + (hasTheme ? '，围绕「' + ctx.theme + '」重新认识了彼此' : '') + '。';
      case 'recruit':
        return date + '，' + org + '在' + place + '举办「' + name + '」，' + guest + actual +
          '名同学在摊位前停下脚步，其中' + ctx.signup + '人现场登记。';
      case 'training':
        return date + '，由' + org + '主办的「' + name + '」在' + place + '开班，' + guest + actual +
          '名同学用' + hours + '完成了一次从听懂到动手的练习' + (hasTheme ? '，内容围绕「' + ctx.theme + '」展开' : '') + '。';
      case 'exhibition':
        return date + '，' + org + '在' + place + '举办「' + name + '」，' + guest + actual + '件作品集中亮相' +
          (hasTheme ? '，主题为「' + ctx.theme + '」' : '') + '，展期' + ctx.exhibitDays + '天。';
      default:
        return date + '，' + org + '在' + place + '举办「' + name + '」，' + guest + actual + '名同学参与' +
          (hasTheme ? '，围绕「' + ctx.theme + '」' : '') + '完成了' + ctx.stepCount + '个环节的交流与体验。';
    }
  }

  /** 主标题：有主题时用类型化标题，无主题时只陈述可核实的事实，不编造话题 */
  var PLAIN_TITLES = [
    '{name}：{actual}名同学共同完成的这次{typeNoun}',
    '记{name}：从筹备到散场',
    '{name}现场：{stepCount}个环节，{actual}人到场'
  ];

  /** 新闻稿主标题（含活动名、有文采） */
  function pressTitle(ctx) {
    var tpl = ctx.themeProvided ? pick(ctx.T.title, ctx.seed) : pick(PLAIN_TITLES, ctx.seed);
    var title = fill(tpl, ctx.vars);
    if (title.indexOf(ctx.name) < 0) title = ctx.name + '：' + title;
    return title;
  }

  /** 新闻稿副标题：有主题从主题提炼，否则取已给亮点或事实描述，不套固定主旨 */
  function pressSubtitle(ctx) {
    if (ctx.themeProvided) {
      return fill(pick([
        '以「{theme}」为主题，{org}与{actual}名同学一起完成了这次{typeNoun}',
        '围绕「{theme}」，把{place}里的这场{typeNoun}留在此刻'
      ], ctx.seed + 1), ctx.vars);
    }
    if (ctx.highlights.length) {
      return clip(stripEnd(ctx.highlights[0]), 36, '');
    }
    return fill('{org}与{actual}名同学在{place}共同完成的这次{typeNoun}', ctx.vars);
  }

  /** 环节回顾句子（按 process 时间线；步骤过多时首尾细化、中段概括，避免流水账） */
  function reviewSentences(ctx) {
    var steps = ctx.process;
    var out = [];
    if (!steps.length) return out;
    out.push('活动从' + steps[0].time + '开始，到' + steps[steps.length - 1].time + '结束，' + steps.length + '个环节依次展开。');
    var detail = steps;
    var middle = '';
    if (steps.length > 5) {
      detail = steps.slice(0, 3).concat(steps.slice(-2));
      middle = '中间的' + (steps.length - 5) + '个环节按流程表依次推进，场务在每个节点前两分钟完成提醒，没有出现明显空档';
    }
    var chunks = [];
    detail.forEach(function (st, idx) {
      var content = stripEnd(st.content);
      if (idx === 0) chunks.push(st.time + '，' + content);
      else chunks.push('到了' + st.time + '，' + content);
    });
    // 合并成 1–2 句，避免逐条罗列
    var firstHalf = chunks.slice(0, Math.ceil(chunks.length / 2)).join('；');
    var secondHalf = chunks.slice(Math.ceil(chunks.length / 2)).join('；');
    out.push(firstHalf + '。');
    if (middle) out.push(middle + '。');
    if (secondHalf) out.push(secondHalf + '。');
    out.push(fill(ctx.T.comment, ctx.vars) + '。');
    return out;
  }

  /** 数据亮点句子 */
  function dataSentences(ctx) {
    var out = [];
    var srcTxt = ctx.stats.sources.length ? '（数据来自' + ctx.stats.sources.length + '份报名表）' : '';
    out.push((ctx.signupEstimated ? '按策划规模预计，本次活动' : '据报名表统计，本次活动共有') +
      ctx.signup + '人报名' + srcTxt + '，最终' + (ctx.actualEstimated ? '约' : '') + ctx.actual +
      '人到场，到场率' + ctx.rate.toFixed(1) + '%。');
    if (ctx.stats.ok) {
      if (ctx.topCollege) {
        var tied = (ctx.collegeItems || []).filter(function (it) {
          return n(it.count, 0) === ctx.topCollegeCount;
        }).length;
        var collegeClause = tied > 1
          ? '其中' + ctx.topCollege + '等' + tied + '个学院并列最多，各' + ctx.topCollegeCount + '人'
          : '其中' + ctx.topCollege + '人数最多，共' + ctx.topCollegeCount + '人';
        out.push('报名同学覆盖' + ctx.collegeCount + '个院系，' + collegeClause + (ctx.peakDay ? '；报名高峰出现在' + ctx.peakDay + '，单日新增' + ctx.peakCount + '人' : '') + '。');
      } else if (ctx.peakDay) {
        out.push('报名高峰出现在' + ctx.peakDay + '，单日新增' + ctx.peakCount + '人，临近截止的报名占比不低。');
      }
      if (ctx.memberKnown) {
        out.push('参与者中社团成员占' + ctx.memberPct.toFixed(1) + '%，其余为非会员同学，新面孔比例较往期上升。');
      }
    } else if (ctx.collegeKnown) {
      out.push('参与同学覆盖' + ctx.collegeCount + '个院系，跨专业参与是本次活动的一个明显特征。');
    }
    if (ctx.awards.count) {
      out.push('本次共评出' + ctx.awards.text + '，' +
        (ctx.T.key === 'contest' ? '各奖项在颁奖环节依次揭晓' : '评选结果在活动现场公布') + '。');
    }
    if (ctx.feedback) {
      out.push('活动后回收的问卷与反馈中，' + stripEnd(ctx.feedback) + '。');
    } else if (ctx.satisfaction !== null) {
      out.push('现场问卷共回收' + (ctx.surveyCount !== null ? ctx.surveyCount + '份' : '若干份') +
        '，满意及以上评价占' + ctx.satisfaction.toFixed(1) + '%。');
    }
    if (ctx.reach !== null) {
      out.push('活动相关图文在公众号与社群的阅读、转发合计触达约' + ctx.reach + '人次。');
    }
    return out;
  }

  /** 参与者反响句子（直接引语） */
  function reactionSentences(ctx) {
    var list = ctx.quotes.length ? ctx.quotes : ctx.T.quotes;
    var out = [];
    var first = list[0];
    if (first) {
      var who = first.who || '一位参与同学';
      out.push('“' + stripEnd(first.text) + '。”' + who + '在活动结束后说。');
    }
    var second = list[1];
    if (second) {
      var who2 = second.who || '另一位同学';
      out.push('“' + stripEnd(second.text) + '。”' + who2 + '这样形容自己的感受。');
    }
    if (!out.length) {
      out.push('散场时，仍有不少同学留在原地交流，交换联系方式、追问细节，久久没有离开。');
    }
    return out;
  }

  /** 新闻稿结尾落款：供稿=联系人，摄影=摄影署名，审核=主办单位 */
  function pressEnding(ctx) {
    return '（供稿：' + ctx.contributor + '　摄影：' + ctx.photographer + '　审核：' + ctx.reviewer + '）';
  }

  /** 段落结构工具 */
  function para(tag, sentences, coreCount) {
    var parts = [];
    var limit = coreCount === undefined ? sentences.length : coreCount;
    sentences.forEach(function (t, i) {
      var text = end(t);
      if (text) parts.push({ t: text, removable: i >= limit });
    });
    return { tag: tag, parts: parts };
  }

  /** 段落总字符数 */
  function paraChars(paras) {
    var total = 0;
    paras.forEach(function (p) {
      p.parts.forEach(function (part) { total += chars(part.t); });
    });
    return total;
  }

  /** 追加一句话到指定段落 */
  function appendTo(paras, tag, text) {
    for (var i = 0; i < paras.length; i++) {
      if (paras[i].tag === tag) {
        paras[i].parts.push({ t: end(text), removable: true });
        return true;
      }
    }
    return false;
  }

  /** 从段落中移除一句可删内容；返回是否移除成功 */
  function removeOne(paras, order) {
    for (var k = 0; k < order.length; k++) {
      for (var i = 0; i < paras.length; i++) {
        if (paras[i].tag !== order[k]) continue;
        var parts = paras[i].parts;
        for (var j = parts.length - 1; j >= 0; j--) {
          if (parts[j].removable) {
            parts.splice(j, 1);
            return true;
          }
        }
      }
    }
    return false;
  }

  /** 缺素材时用于补足篇幅的具体细节句（按段落分配，均与活动相关） */
  function pressPadPool(ctx) {
    var p = ctx.place, a = ctx.actual, st = ctx.staffCount;
    var pool = [
      { tag: 'scene', t: '入口处的签到表被分成四列，志愿者按姓氏首字母快速找到名字，再递上一支笔请同学确认信息' },
      { tag: 'scene', t: '场内的座位牌与桌签在开场前逐个核对过，' + st + '名工作人员分别守在签到、引导、场务与摄影点位上' },
      { tag: 'scene', t: '为了让后排同学也能看清，' + p + '的工作人员临时加开了一块侧屏，画面与主屏同步' },
      { tag: 'review', t: '每个环节之间只留两三分钟的转场时间，场务把话筒、翻页笔与水逐一递到位，几乎没有出现冷场' },
      { tag: 'review', t: '流程表被打印出来贴在后台门口，完成一项就划掉一项，遇到临时调整时负责人当场重新分工' },
      { tag: 'data', t: '从报名数据看，活动信息在班级群与社群转发后传播速度明显加快，临近截止的两天新增报名占了不小比例' },
      { tag: 'data', t: '与往期同类活动相比，本次的报名转化率与到场率都更稳定，说明活动时间与宣传节奏的选择是有效的' },
      { tag: 'react', t: '散场后，几位同学围着负责人询问下一期的时间，还有人主动提出愿意加入筹备组' },
      { tag: 'react', t: '在活动群里，当晚的复盘消息一直刷到很晚，最多的一条建议被十几位同学点了赞' },
      { tag: 'scene', t: '现场的物料袋里除了资料，还放了一张印着活动主题的书签，不少同学当场就夹进了笔记本' },
      { tag: 'review', t: '负责摄影的同学在两个机位之间来回跑，活动结束时相机里已经存了两百多张可用照片' }
    ];
    return pool;
  }

  /** 生成新闻稿 DocSpec */
  function buildPress(ctx) {
    var lead = leadSentence(ctx);
    var scene = ctx.T.scene.map(function (t) { return fill(t, ctx.vars); });
    var review = reviewSentences(ctx);
    var data = dataSentences(ctx);
    var react = reactionSentences(ctx);

    var paras = [];
    paras.push(para('lead', [lead], 1));
    paras.push(para('scene', scene, 2));
    paras.push(para('review', review, 2));
    paras.push(para('data', data, 1));
    paras.push(para('react', react, 1));

    // 补足篇幅：优先保证正文 790–850 字
    var pads = pressPadPool(ctx);
    var padIdx = 0;
    var guard = 0;
    while (paraChars(paras) < 800 && padIdx < pads.length && guard++ < 40) {
      var pad = pads[padIdx++];
      if (!appendTo(paras, pad.tag, pad.t)) appendTo(paras, 'scene', pad.t);
    }
    // 压缩篇幅：优先删数据/反响中的次要句，再删现场与回顾
    var order = ['data', 'react', 'scene', 'review'];
    guard = 0;
    while (paraChars(paras) > 852 && guard++ < 60) {
      if (!removeOne(paras, order)) break;
    }

    var ending = pressEnding(ctx);
    paras.push(para('end', [ending], 1));

    var title = pressTitle(ctx);
    var subtitle = pressSubtitle(ctx);
    var meta = [
      ['主办单位', ctx.org],
      ['活动时间', ctx.dateFull + ' ' + ctx.timeStart + '—' + ctx.timeEnd],
      ['活动地点', ctx.place]
    ];

    // 总字数（含标题与信息栏）也控制在 1000 字以内
    var totalChars = chars(title) + chars(subtitle);
    meta.forEach(function (row) { totalChars += chars(row[0]) + chars(row[1]); });
    totalChars += paraChars(paras);
    guard = 0;
    while (totalChars > 985 && guard++ < 60) {
      if (!removeOne(paras, order)) break;
      totalChars = chars(title) + chars(subtitle) + paraChars(paras);
      meta.forEach(function (row) { totalChars += chars(row[0]) + chars(row[1]); });
    }

    // 输出：导语 + 正文段落（回顾可拆为多段，保持 3–5 段正文的观感）
    var blocks = [];
    paras.forEach(function (p) {
      if (p.tag === 'end') return;
      var text = p.parts.map(function (x) { return x.t; }).join('');
      if (!text) return;
      blocks.push({ type: 'p', text: text, align: p.tag === 'lead' ? 'justify' : 'justify' });
    });
    blocks.push({ type: 'p', text: ending, align: 'right' });

    return {
      title: title,
      subtitle: subtitle,
      meta: meta,
      blocks: blocks,
      footer: ctx.org + '　' + ctx.dateFull
    };
  }

  /* =======================================================================
   * 7. 活动总结
   * ===================================================================== */

  /** 经费分项权重（按类型调整，合计为 100 左右） */
  var BUDGET_ITEMS = [
    { key: 'venue', name: '场地与设备', note: '场地申请、设备租赁与调试' },
    { key: 'material', name: '物料制作', note: '横幅、展板、签到与宣传物料' },
    { key: 'promo', name: '宣传推广', note: '海报设计、推文与社群推广' },
    { key: 'prize', name: '奖品与纪念品', note: '奖项设置与参与纪念品' },
    { key: 'food', name: '餐饮与茶歇', note: '饮用水、茶歇与工作餐' },
    { key: 'transport', name: '交通与差旅', note: '嘉宾往返与物资运输' },
    { key: 'insurance', name: '保险与安全', note: '活动保险与应急药品' },
    { key: 'reserve', name: '应急备用', note: '不可预见支出准备金' }
  ];

  var BUDGET_WEIGHTS = {
    lecture: [3, 4, 4, 2, 3, 2, 1, 1],
    contest: [3, 4, 3, 10, 3, 2, 1, 2],
    performance: [5, 5, 4, 4, 2, 2, 1, 2],
    volunteer: [1, 5, 3, 2, 4, 4, 2, 1],
    salon: [3, 2, 2, 1, 6, 1, 1, 1],
    team: [5, 3, 2, 2, 6, 5, 2, 1],
    recruit: [2, 6, 5, 3, 2, 1, 1, 1],
    training: [3, 4, 3, 2, 2, 2, 1, 1],
    exhibition: [5, 6, 4, 2, 2, 2, 1, 1],
    other: [3, 5, 4, 3, 3, 2, 1, 1]
  };

  /** 按权重把整数总额精确拆分 */
  function allocate(total, weights) {
    var t = Math.round(total);
    var sum = 0, i;
    for (i = 0; i < weights.length; i++) sum += weights[i];
    if (t <= 0 || sum <= 0) return weights.map(function () { return 0; });
    var raw = weights.map(function (w) { return (t * w) / sum; });
    var base = raw.map(Math.floor);
    var used = 0;
    for (i = 0; i < base.length; i++) used += base[i];
    var rest = t - used;
    var order = raw.map(function (v, idx) {
      return { idx: idx, frac: v - Math.floor(v) };
    }).sort(function (a, b) {
      return b.frac - a.frac || a.idx - b.idx;
    });
    for (i = 0; i < rest; i++) base[order[i % order.length].idx] += 1;
    return base;
  }

  /** 经费决算表 */
  function budgetTable(ctx) {
    var T = ctx.T;
    var weights = BUDGET_WEIGHTS[T.key] || BUDGET_WEIGHTS.other;
    var plans = allocate(ctx.budgetPlan, weights);
    var reals = allocate(ctx.budgetActual, weights);
    var rows = [];
    var sumPlan = 0, sumReal = 0;
    BUDGET_ITEMS.forEach(function (item, i) {
      var plan = plans[i], real = reals[i];
      sumPlan += plan;
      sumReal += real;
      if (plan === 0 && real === 0) return;
      var diff = plan - real;
      var note = item.note;
      if (diff > 0) note += '，结余' + yuan(diff) + '元';
      else if (diff < 0) note += '，超支' + yuan(-diff) + '元';
      rows.push([item.name, yuan(plan), yuan(real), yuan(diff), note]);
    });
    rows.push(['合计', yuan(sumPlan), yuan(sumReal), yuan(sumPlan - sumReal),
      ctx.budgetPlan >= ctx.budgetActual ? '预算内完成' : '超出预算，需补充说明']);
    return {
      table: {
        type: 'table',
        headers: ['项目', '预算（元）', '实际（元）', '差额（元）', '说明'],
        rows: rows,
        widths: [2200, 1400, 1400, 1400, 2600]
      },
      sumPlan: sumPlan,
      sumReal: sumReal
    };
  }

  /** 目标达成表 */
  function goalRows(ctx) {
    var rows = [];
    function judge(rate) {
      if (rate >= 100) return '达成';
      if (rate >= 90) return '基本达成';
      return '未达成';
    }
    // 达成率封顶 100%：超过计划记为「超额完成」，避免出现 101.1%、107.3% 这类看不懂的数字
    function add(label, planText, actualText, planVal, actualVal, note) {
      var rawRate = planVal > 0 ? (actualVal / planVal) * 100 : 100;
      var shown = Math.min(100, Math.max(0, rawRate));
      var tag = rawRate > 100 ? '超额完成' : judge(rawRate);
      rows.push([label, planText, actualText, round(shown, 1).toFixed(1) + '%', tag + '，' + note]);
    }
    add('参与人数', '不少于' + ctx.scale + '人', ctx.actual + '人', ctx.scale, ctx.actual,
      ctx.actualEstimated ? '未提供签到数据，按计划规模估算' :
        (ctx.actual >= ctx.scale ? '现场规模达到策划预期' : '受时间与场地限制略低于计划'));
    add('报名人数', '不少于' + Math.max(ctx.scale, Math.round(ctx.scale * 1.1)) + '人', ctx.signup + '人',
      Math.max(ctx.scale, Math.round(ctx.scale * 1.1)), ctx.signup,
      ctx.signupEstimated ? '未导入报名表，按计划规模估算' : '报名通道按计划开放');
    add('到场率', '不低于85%', ctx.rate.toFixed(1) + '%', 85, ctx.rate,
      ctx.actualEstimated ? '按估算人数测算' : (ctx.rate >= 85 ? '签到组织有效' : '临场缺席偏多'));
    if (ctx.satisfaction !== null) {
      add('满意度', '满意及以上不低于90%', ctx.satisfaction.toFixed(1) + '%', 90, ctx.satisfaction,
        ctx.satisfaction >= 90 ? '内容与组织获得认可' : '仍有改进空间');
    }
    // 没有报名表数据时，不再拿默认值 96.0% 去比 95% 的目标（会算出 101.1%）
    if (ctx.completeKnown) {
      add('信息完整率', '不低于95%', ctx.completeRate.toFixed(1) + '%', 95, ctx.completeRate,
        '报名表必填项核对');
    }
    return rows;
  }

  /** 数据与成效表 */
  function dataTableRows(ctx) {
    var rows = [];
    rows.push(['报名人数', ctx.signup + ' 人' + (ctx.signupEstimated ? '（估算）' : ''),
      ctx.signupEstimated ? '未导入报名表，按计划规模估算' : '报名表去重后统计' + (ctx.stats.sources.length ? '，来源 ' + ctx.stats.sources.length + ' 份表格' : '')]);
    rows.push(['实到人数', ctx.actual + ' 人' + (ctx.actualEstimated ? '（估算）' : ''),
      ctx.actualEstimated ? '未提供签到数据，按报名规模估算' : '现场签到表核对']);
    rows.push(['到场率', ctx.rate.toFixed(1) + '%', '实到人数 ÷ 报名人数']);
    if (ctx.collegeKnown) {
      rows.push(['覆盖院系', (ctx.collegeEstimated ? '约 ' : '') + ctx.collegeCount + ' 个', ctx.collegeEstimated ? '按报名信息估算' : '报名表院系字段']);
    }
    if (ctx.memberKnown) rows.push(['社团成员占比', ctx.memberPct.toFixed(1) + '%', '报名表「是否会员」字段']);
    if (ctx.completeKnown) {
      rows.push(['报名信息完整率', ctx.completeRate.toFixed(1) + '%', '姓名、学院、手机号三项齐全比例']);
    }
    if (ctx.satisfaction !== null) {
      rows.push(['问卷满意度', ctx.satisfaction.toFixed(1) + '%',
        '回收问卷 ' + (ctx.surveyCount !== null ? ctx.surveyCount + ' 份' : '若干份') + (ctx.surveyKnown ? '' : '（估算）') +
        '，满意及以上占比' + (ctx.satisfactionKnown ? '' : '（估算）')]);
    }
    if (ctx.reach !== null) {
      rows.push(['传播触达', '约 ' + ctx.reach + ' 人次', '公众号阅读、社群与朋友圈转发合计（估算）']);
    }
    if (ctx.photos !== null) {
      rows.push(['现场影像', ctx.photos + ' 张' + (ctx.photosKnown ? '' : '（估算）'), '宣传部现场跟拍，已归档']);
    }
    if (ctx.stats.fee) {
      var total = n(ctx.stats.fee.total, 0), paid = n(ctx.stats.fee.paid, 0), amount = n(ctx.stats.fee.amount, 0);
      if (total > 0) rows.push(['缴费情况', '已缴 ' + paid + '/' + total + ' 人', '合计 ' + yuan(amount) + ' 元，报名表缴费字段']);
    }
    return rows;
  }

  /** 问题与不足（仅使用用户填写的内容，留空则不生成） */
  function problemList(ctx) {
    if (ctx.issues.length) {
      return { items: ctx.issues.slice(0, 4), generated: false };
    }
    return { items: [], generated: false };
  }

  /** 针对一个问题生成改进措施（用于 1:1 对应） */
  function improvementFor(problem) {
    var p = s(problem);
    if (/集中提交|打印|服务器|网络.{0,4}(排队|拥堵)|提交.{0,6}(排队|拥堵)/.test(p)) {
      return '把报名与提交流程拆成两个时段，设置分批提交与备用打印点，截止前两小时安排专人值守答疑，避免集中拥堵';
    }
    if (/报名.{0,8}(集中|拥堵|截止)|截止前.{0,10}报名|报名(启动|入口)|宣传.{0,6}(晚|迟|短|不足)|推广.{0,6}(晚|迟|短|不足)|预热/.test(p)) {
      return '提前两周启动宣传与报名，按「预热—开票—倒计时」三轮排期，报名页设置人数预警，物料按报名曲线分批到位';
    }
    if (/答辩|路演|展示|问答|互动|提问|答疑|时间.{0,6}(压缩|偏紧|不足|紧)|被压缩/.test(p)) {
      return '为答辩与互动环节设置硬性时间盒（含超时提醒），压缩串场与致辞时长，必要时把部分展示改为线上提交';
    }
    if (/签到|纸质名单|名单|信息|字段|报名表/.test(p)) {
      return '报名表模板前置必填校验，截止后二十四小时内完成去重与核对，签到改用电子名单并提前导出纸质备份';
    }
    if (/物资|物料|设备|器材|音响|灯光|空调|场地/.test(p)) {
      return '活动前三天完成物资清点与双人复核，提前一天完成场地与设备联调，准备备用电源、投影与转接线';
    }
    if (/安全|医疗|风险|天气/.test(p)) {
      return '完善安全与天气预案，增加安全员与应急联络人，活动前完成风险提示、药品与备用场地检查';
    }
    if (/反馈|问卷|复盘|数据|统计/.test(p)) {
      return '统一使用线上问卷收集反馈，活动结束当天完成数据回收，复盘会形成书面清单并明确责任人';
    }
    if (/费用|预算|报销|经费/.test(p)) {
      return '活动前明确预算与报销口径，支出按项目登记票据，结项后一周内完成决算与公示';
    }
    if (/时间|节奏|环节|流程|延误|拖/.test(p)) {
      return '在流程表中为每个环节设置硬性时间盒，由场务计时并在超时三分钟时提示主持人，预留十分钟机动时间';
    }
    return '把该问题写入下一期策划的风险清单，明确责任人与完成时限，筹备会逐项过表销项';
  }

  /** 活动概述段落 */
  function overviewParagraphs(ctx) {
    var T = ctx.T;
    var p1 = '本次活动由' + ctx.org + '主办，于' + ctx.dateFull + '在' + ctx.place + '举行。活动以「' + ctx.theme + '」为主题，面向' + ctx.audienceText + '，采用' + T.form + '的形式，' + T.goal + '。' +
      (ctx.guests.length ? ctx.guests.join('、') + '等到场参与。' : '');
    var p2 = '筹备工作提前' + ctx.prepDays + '天启动，筹备组按「方案—场地—宣传—报名—执行—复盘」的节奏推进，先后完成' + (2 + (ctx.seed % 2)) + '次筹备会、场地申请与两轮宣传。报名通道开放后共收到' + ctx.signup + '人报名，其中' + Math.round(ctx.signup * 0.4) + '人在开放首日完成提交，报名曲线在截止前两天再次抬升。';
    var p3 = '活动当天共设置' + ctx.stepCount + '个环节，从' + ctx.timeStart + '的签到入场到' + ctx.timeEnd + '的合影散场，历时约' + ctx.durationMin + '分钟。' + (ctx.actualEstimated ? '约' : '') + ctx.actual + '名同学到场参与，' + ctx.staffCount + '名工作人员分布在签到、场务、宣传与机动岗位，各环节按流程表推进，现场组织有序。';
    var p4 = '从结果看，报名' + ctx.signup + '人、到场' + ctx.actual + '人，到场率' + ctx.rate.toFixed(1) + '%' +
      (ctx.satisfaction !== null ? '，问卷满意度' + ctx.satisfaction.toFixed(1) + '%' : '，现场反馈整体积极') +
      '，基本达到策划预期。活动结束后当天完成场地清理与物资清点，影像与名单资料已归档，为复盘与下一次活动留足了素材。';
    return [p1, p2, p3, p4];
  }

  /** 亮点与经验条目 */
  function highlightItems(ctx) {
    if (ctx.highlights.length) {
      var items = ctx.highlights.slice(0, 5);
      if (items.length < 3) {
        items = items.concat(ctx.T.highlights.slice(0, 3 - items.length));
      }
      return items.map(function (t) { return fill(t, ctx.vars); });
    }
    return ctx.T.highlights.slice(0, 4).map(function (t) { return fill(t, ctx.vars); });
  }

  /** 后续计划条目 */
  function nextItems(ctx) {
    var list = ctx.T.next.slice(0, 2).map(function (t) { return fill(t, ctx.vars); });
    list.push('把报名、签到与问卷数据沉淀成标准模板，下一期活动直接复用，减少重复劳动');
    list.push('从本次工作人员中选拔' + ctx.n + '名骨干进入下一期筹备组，明确分工与交接时间');
    return list;
  }

  /** 附件清单 */
  function attachmentItems(ctx) {
    return [
      qn(ctx.name) + '策划书（含流程表、预算表与人员分工）',
      '报名汇总表（' + ctx.signup + ' 条记录，含去重与异常标记）',
      '现场签到表（实到 ' + ctx.actual + ' 人，纸质原件与电子台账）',
      '活动照片' + (ctx.photos !== null ? ' ' + ctx.photos + ' 张' : '') + '及短视频素材（已按环节归档）',
      '经费决算表与票据扫描件（预算 ' + yuan(ctx.budgetPlan) + ' 元，实际 ' + yuan(ctx.budgetActual) + ' 元）',
      '活动问卷统计结果（' + (ctx.surveyCount !== null ? '回收 ' + ctx.surveyCount + ' 份' : '回收情况见反馈记录') + '）',
      '新闻稿定稿与社媒推文存档（公众号、微博、朋友圈三版）',
      '活动复盘会议记录与改进措施清单'
    ];
  }

  /** 生成活动总结 DocSpec */
  function buildReport(ctx) {
    var T = ctx.T;
    var blocks = [];
    var sec = 0;
    function heading(text) {
      blocks.push({ type: 'h2', text: CN_ORD[sec++] + '、' + text });
    }
    function p(text) {
      if (text) blocks.push({ type: 'p', text: text });
    }

    // 一、基本信息
    heading('基本信息');
    blocks.push({
      type: 'kv',
      rows: [
        ['活动名称', ctx.name],
        ['活动类型', T.label],
        ['主办单位', ctx.org],
        ['活动主题', ctx.theme],
        ['活动时间', ctx.dateFull + ' ' + ctx.timeStart + '—' + ctx.timeEnd],
        ['活动地点', ctx.place],
        ['活动规模', '计划 ' + ctx.scale + ' 人 / 实到 ' + ctx.actual + ' 人'],
        ['活动对象', ctx.audienceText],
        ['活动形式', T.form],
        ['供稿人', ctx.contributor],
        ['摄影', ctx.photographer]
      ],
      widths: [2400, 6600]
    });

    // 二、活动概述
    heading('活动概述');
    overviewParagraphs(ctx).forEach(p);

    // 三、目标达成情况
    heading('目标达成情况');
    p('对照策划书设定的目标，本次活动在参与规模、内容完成度、传播效果与信息质量四个维度上的达成情况如下表。达成率按「实际值 ÷ 计划值」计算并封顶 100%，超过计划记为「超额完成」，90% 以上记为基本达成。');
    var gRows = goalRows(ctx);
    blocks.push({
      type: 'table',
      headers: ['目标项', '计划值', '实际值', '达成率', '说明'],
      rows: gRows,
      widths: [1500, 2200, 1500, 1300, 2500]
    });
    var achieved = 0, basic = 0, miss = 0, best = '';
    var bestRate = -1;
    gRows.forEach(function (r) {
      var rv = parseFloat(r[3]);
      if (!isFinite(rv)) return;
      if (rv >= 100) achieved++;
      else if (rv >= 90) basic++;
      else miss++;
      if (rv > bestRate) { bestRate = rv; best = r[0]; }
    });
    p('总体来看，' + gRows.length + ' 项目标中 ' + achieved + ' 项达成、' + basic + ' 项基本达成、' + miss + ' 项未达成。其中「' + best + '」完成情况最好，达成率 ' + bestRate.toFixed(1) + '%；' + (miss ? '未达成项主要集中在' + (gRows.filter(function (r) { return parseFloat(r[3]) < 90; }).map(function (r) { return '「' + r[0] + '」'; }).join('、') || '可量化指标') + '，需在下一期方案中单独设项跟进。' : '各项指标均在可接受区间内，说明本次策划的目标设定与资源配置基本匹配。'));

    // 四、数据与成效
    heading('数据与成效');
    p('以下数据来自报名汇总表、现场签到与活动后问卷，口径见表内说明。凡标注「约」或「估算」的指标，系素材未完整提供时的合理估算，正式对外发布前建议以原始台账复核。');
    blocks.push({
      type: 'table',
      headers: ['指标', '数值', '统计口径'],
      rows: dataTableRows(ctx),
      widths: [2100, 2100, 4800]
    });
    var insightItems = [];
    if (ctx.stats.insights.length) {
      insightItems = ctx.stats.insights.slice(0, 4);
    } else {
      insightItems = [
        '报名 ' + ctx.signup + ' 人、到场 ' + ctx.actual + ' 人，到场率 ' + ctx.rate.toFixed(1) + '%，在同类活动中处于正常区间',
        ctx.satisfaction !== null
          ? '问卷满意度 ' + ctx.satisfaction.toFixed(1) + '%，内容质量是参与者认可度最高的方面'
          : '现场交流与反馈整体积极，具体满意度可在下次问卷中量化',
        ctx.reach !== null
          ? '活动图文触达约 ' + ctx.reach + ' 人次，传播主要集中在活动当天与次日'
          : '活动图文在公众号与社群同步发布，形成了二次传播',
        '报名信息整理可按报名表模板一次性导入，完整率、学院分布等指标会自动统计'
      ];
    }
    if (ctx.awards.count) {
      insightItems.unshift('本次共评出' + ctx.awards.text + '，获奖名单已同步至社团公众号与活动群');
    }
    blocks.push({ type: 'bullets', items: insightItems.slice(0, 5) });
    if (ctx.feedback) {
      blocks.push({ type: 'quote', text: '参与者反馈：' + stripEnd(ctx.feedback) + '。' });
    }
    blocks.push({
      type: 'note',
      text: '数据来源：报名汇总表' + (ctx.stats.sources.length ? '（' + ctx.stats.sources.length + ' 份）' : '') +
        '、现场签到表与活动后问卷' + (ctx.surveyCount !== null ? '（' + ctx.surveyCount + ' 份）' : '') + '。如需对外发布，请以原始数据复核后使用。'
    });

    // 五、亮点与经验
    heading('亮点与经验');
    blocks.push({ type: 'numbers', items: highlightItems(ctx) });

    // 六、问题与不足（留空不自动生成）
    heading('问题与不足');
    var problems = problemList(ctx);
    if (problems.items.length) {
      blocks.push({ type: 'bullets', items: problems.items });
    } else {
      blocks.push({
        type: 'note',
        text: '本次未记录问题与不足；如需在总结中体现，请在「③ 做总结」的「遇到的问题」中补充后重新生成。'
      });
    }

    // 七、改进措施
    heading('改进措施');
    if (problems.items.length) {
      p('针对上述问题，逐条制定改进措施，明确责任分工与完成时限，并在下一次筹备会上逐项验收。');
      var impRows = [];
      problems.items.forEach(function (prob, i) {
        var imp = ctx.improvements[i] ? ctx.improvements[i] : improvementFor(prob, ctx);
        var owner = ['活动负责人', '宣传部负责人', '场务组负责人', '报名与数据组'][i % 4];
        var deadline = ['下一期策划定稿前', '下一期宣传启动前', '下一期活动前一周', '本月内'][i % 4];
        impRows.push([String(i + 1), stripEnd(prob), stripEnd(imp), owner, deadline]);
      });
      blocks.push({
        type: 'table',
        headers: ['序号', '对应问题', '改进措施', '责任分工', '完成时限'],
        rows: impRows,
        widths: [600, 2500, 3300, 1400, 1200]
      });
    } else {
      blocks.push({
        type: 'note',
        text: '未填写问题记录，本次不自动生成通用问题；补充问题后会自动形成「问题 ↔ 改进措施」的对照表。'
      });
    }

    // 八、经费决算
    heading('经费决算');
    var budget = budgetTable(ctx);
    var diff = ctx.budgetPlan - ctx.budgetActual;
    p('本次活动预算 ' + yuan(ctx.budgetPlan) + ' 元，实际支出 ' + yuan(ctx.budgetActual) + ' 元，' +
      (diff >= 0 ? '结余 ' + yuan(diff) + ' 元，结余率 ' + pctStr(diff, ctx.budgetPlan) + '，已按财务要求退回或结转。'
        : '超支 ' + yuan(-diff) + ' 元，超支部分已在决算说明中列明原因。') +
      '分项预算与决算如下表，合计与总额一致。');
    blocks.push(budget.table);
    p('说明：分项金额按活动类型与实际支出结构分摊，单个科目的四舍五入差额已并入「应急备用」科目，确保分项合计与总额一致；所有票据已按项目归档，可随时查验。');

    // 九、后续计划
    heading('后续计划');
    blocks.push({ type: 'numbers', items: nextItems(ctx) });

    // 十、附件清单
    heading('附件清单');
    blocks.push({ type: 'bullets', items: attachmentItems(ctx) });

    blocks.push({ type: 'note', text: '本总结由' + ctx.org + '整理，供稿：' + ctx.contributor + '；摄影：' + ctx.photographer + '。数据统计截止活动结束后一周，原始名单、问卷与票据均已归档，可按需调阅。' });

    return {
      title: qn(ctx.name) + '活动总结',
      subtitle: ctx.org + '　' + ctx.dateFull,
      blocks: blocks,
      footer: ctx.org + '　' + ctx.dateFull
    };
  }

  /* =======================================================================
   * 8. 社媒文案
   * ===================================================================== */

  /** 公众号标题（≤30 字，有传播感） */
  function socialTitle(ctx) {
    var themeShort = clip(ctx.theme, 13, '');
    var candidates = [
      qn(ctx.name) + '精彩回顾：' + themeShort,
      ctx.name + '｜' + themeShort,
      '现场直击｜' + ctx.name,
      qn(ctx.name) + '高光时刻'
    ];
    var i;
    for (i = 0; i < candidates.length; i++) {
      if (chars(candidates[i]) <= 30) return candidates[i];
    }
    return clip(candidates[0], 30);
  }

  /** 微博（≤140 字，含话题标签） */
  function socialWeibo(ctx) {
    var tag = '#' + ctx.name + '#';
    var core = tag + ' ' + ctx.dateShort + '，' + ctx.actual + '名同学在' + ctx.place +
      '完成了这场' + ctx.T.noun + '。' + themeLine(ctx);
    var extras = [
      ' ' + (ctx.highlights.length ? stripEnd(ctx.highlights[0]) + '。' : '现场图文与金句已整理，戳长图看回顾。'),
      ' #校园活动#',
      ' 你在现场吗？评论区聊聊。'
    ];
    var out = core;
    var i;
    for (i = 0; i < extras.length; i++) {
      if (chars(out + extras[i]) <= 139) out += extras[i];
    }
    if (chars(out) > 140) {
      out = clip(out, 140);
      if (out.indexOf('#') < 0) out = clip(tag, 140);
    }
    return out;
  }

  /** 朋友圈（≤120 字） */
  function socialMoments(ctx) {
    var core = ctx.dateShort + '，' + ctx.actual + '位同学在' + ctx.place + '一起完成了这场' + ctx.T.noun + '。';
    var extras = [
      ' ' + (ctx.highlights.length ? clip(stripEnd(ctx.highlights[0]), 34) + '。' : '有人在台上讲，有人在台下记，散场了还围在一起聊。'),
      ' 感谢每一位到场的你，我们下次见！'
    ];
    var out = core;
    var i;
    for (i = 0; i < extras.length; i++) {
      if (chars(out + extras[i]) <= 119) out += extras[i];
    }
    if (chars(out) > 120) out = clip(out, 120);
    return out;
  }

  /** 一句话凝练主题（社交文案用） */
  function themeLine(ctx) {
    return '围绕「' + clip(ctx.theme, 16, '') + '」，现场有分享、有互动，也有同学散场后留下来继续聊。';
  }

  /** 推文正文（300–500 字） */
  function socialArticle(ctx) {
    var paras = [];
    paras.push({ t: ctx.dateShort + '，' + ctx.actual + '名同学在' + ctx.place + '，一起完成了这场' + ctx.T.noun + '。' +
      '报名通道开放后，' + ctx.signup + '人提交了信息，最终' + ctx.actual + '人到场，到场率' + ctx.rate.toFixed(1) + '%。', removable: false });
    var steps = ctx.process.slice(0, 3);
    if (steps.length) {
      var parts = steps.map(function (st) { return st.time + '，' + stripEnd(st.content); });
      paras.push({ t: '当天流程依次是：' + parts.join('；') + '。' + fill(ctx.T.comment, ctx.vars) + '。', removable: true });
    } else {
      paras.push({ t: fill(ctx.T.comment, ctx.vars) + '。', removable: true });
    }
    if (ctx.awards.count) {
      var lead = ctx.T.key === 'competition'
        ? '经过' + ctx.hoursText + '的比拼，'
        : '整场活动持续' + ctx.hoursText + '，';
      paras.push({ t: lead + ctx.awards.text + '最终揭晓；' + (ctx.highlights.length ? stripEnd(ctx.highlights[0]) + '。' : '优秀作品将在社团公众号陆续展出。'), removable: true });
    } else {
      paras.push({ t: (ctx.highlights.length ? stripEnd(ctx.highlights[0]) + '，' + stripEnd(ctx.highlights[1] || ctx.highlights[0]) + '。' : '现场最打动人的，是不断被举手打断的提问环节，和散场后仍围在一起讨论的同学。'), removable: true });
    }
    var q = (ctx.quotes.length ? ctx.quotes[0] : ctx.T.quotes[0]);
    if (q) {
      paras.push({ t: '“' + stripEnd(q.text) + '。”' + (q.who || '一位参与同学') + '在活动结束后这样说。这句话大概也是我们想留下的东西：' + clip(ctx.theme, 14, '') + '，不只是一个标题。', removable: true });
    }
    paras.push({ t: '感谢每一位到场的你，也感谢' + ctx.staffCount + '位在台前幕后忙碌的工作人员。' +
      qn(ctx.name) + '的影像、金句与复盘正在整理，下一期活动已在筹备中，关注' + ctx.org + '，第一时间获取报名信息。', removable: false });

    function total() {
      var t = 0;
      paras.forEach(function (p) { t += chars(p.t); });
      return t;
    }
    var pads = [
      '签到台前的队伍从入口一直排到走廊，志愿者按名单快速核对，把资料袋递到每一双伸过来的手里。',
      '活动开始前的最后十分钟，工作人员把话筒、翻页笔和备用电源又检查了一遍，流程表上已经划掉了大半。',
      '现场的照片和短视频会在整理后陆续发布，没到场的同学也能顺着时间线看完整场活动。',
      '如果你也想参与下一次的筹备，欢迎在后台留言，告诉我们你擅长什么、想做什么。',
      '我们的活动预告会提前一周发出，报名名额有限，建议设置提醒，别错过开票时间。'
    ];
    var pi = 0;
    while (total() < 380 && pi < pads.length) {
      var target = paras[1];
      target.t += pads[pi++];
    }
    while (total() > 470) {
      var removed = false;
      for (var i = paras.length - 1; i >= 0; i--) {
        if (paras[i].removable) { paras.splice(i, 1); removed = true; break; }
      }
      if (!removed) break;
    }
    if (total() > 500) {
      paras[paras.length - 1].t = clip(paras[paras.length - 1].t, chars(paras[paras.length - 1].t) - (total() - 500));
    }
    return paras.map(function (p) { return p.t; }).join('\n\n');
  }

  /* =======================================================================
   * 9. 对外 API
   * ===================================================================== */

  /**
   * 生成新闻稿、活动总结与社媒文案。
   * @param {Object} input 活动档案（字段见 CONTRACT 第 7 节，均可选）
   * @returns {{press: Object, report: Object, social: Object}} 三份 DocSpec / 纯文本
   */
  function generate(input) {
    var ctx = buildContext(input);
    var press = buildPress(ctx);
    var report = buildReport(ctx);
    var social = {
      title: socialTitle(ctx),
      weibo: socialWeibo(ctx),
      moments: socialMoments(ctx),
      article: socialArticle(ctx)
    };
    return scrubDeep({ press: press, report: report, social: social });
  }

  global.CLUB = global.CLUB || {};
  global.CLUB.summary = {
    generate: generate,
    /** 供页面/测试使用的字数口径：不含空白的字符数 */
    countChars: chars
  };
})(typeof window !== 'undefined' ? window : globalThis);

