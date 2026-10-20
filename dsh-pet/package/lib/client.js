window.__ModuleLoader__.load({
  id: "dsh-pet",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");

    const inject = ['slots', 'timer'];

    function apply(ctx) {
      const slots = ctx.get('slots')
      const timer = ctx.get('timer')
      if (slots === undefined || timer === undefined) return

      const CAT = {
        idle: '待机呼吸休闲',
        turn: '东张西望',
        moves: ['螃蟹走路', '原地漂浮踏步', '原地左转奔跑'],
        clicks: ['点击回应 - 开心跃动', '点击回应 - 害羞惊讶', '点击回应 - 傲娇生气（侧身展示）'],
        drag: '被鼠标拖拽悬空反馈',
        sleep: '原地小憩沉眠',
        wake: '打瞌睡被惊醒',
        focus: '写代码',
        celebrate: '可爱宅舞',
        stretch: '超大伸懒腰',
        acts: [
          '被落叶淹没', '被吓一跳（炸毛）', '超大伸懒腰', '吃Token', '吃白饭', '吃冰淇淋融化',
          '吃晚餐', '吃午餐', '吃早餐', '吹气球', '打瞌睡被惊醒', '大口吃零食',
          '动物环绕', '堆雪人', '放风筝', '哈欠连天', '鲸鱼吐泡泡特效', '可爱宅舞',
          '蓝鲸现世', '女仆屈膝礼仪', '轻快记录', '轻快摇摆舞', '深度思考碎碎念', '偷吃零食被抓住',
          '玩水枪', '玩游戏气急败坏', '小幅度原地 360 度旋转展示', '小提琴演奏', '写代码', '摇扇纳凉',
          '用鲸鱼尾巴拍打地面', '优雅女仆舞', '悠闲哼歌', '原地蹲下玩玩具汽车', '原地敲击桌面互动', '原地跳跃抓碎头顶物品',
          '原地小憩沉眠', '原地重力下蹲压缩', '原地专心玩魔方', '照镜子', '整体换装试色', '中秋赏月吃月饼'
        ]
      }

      const CSS = `.dsh-vpet-anchor{position:fixed;right:24px;bottom:8px;z-index:9000;pointer-events:auto;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;line-height:0;transition:transform .12s ease-out}
.dsh-vpet-anchor.dsh-vpet-dragging{cursor:grabbing;transition:none}
.dsh-vpet-video{display:block;pointer-events:none;-webkit-user-drag:none;user-select:none;background:transparent;outline:none;object-fit:contain;transform-origin:center center}
.dsh-vpet-fallback{display:flex;align-items:center;justify-content:center;font-size:64px;pointer-events:none;user-select:none;background:transparent}
.dsh-vpet-bubble{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:12px;max-width:340px;min-width:36px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#333);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:16px;padding:10px 14px;font-size:13px;line-height:1.6;box-shadow:0 6px 24px rgba(0,0,0,.18);white-space:pre-wrap;word-break:break-word;text-align:left;pointer-events:none;animation:dsh-vpet-pop-x .16s ease-out}
.dsh-vpet-bubble:after{content:"";position:absolute;top:100%;left:50%;transform:translateX(-50%);border:6px solid transparent;border-top-color:var(--dsw-alias-bg-overlay,#fff)}
.dsh-vpet-bubble-down{bottom:auto;top:100%;margin-top:12px;margin-bottom:0}
.dsh-vpet-bubble-down:after{top:auto;bottom:100%;border-top-color:transparent;border-bottom-color:var(--dsw-alias-bg-overlay,#fff)}
.dsh-vpet-focusbadge{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:12px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#333);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:12px;padding:5px 12px;font-size:12px;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,.18);white-space:nowrap;pointer-events:none;animation:dsh-vpet-pop-x .16s ease-out}
.dsh-vpet-menu{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:10px;min-width:172px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#333);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:14px;box-shadow:0 10px 32px rgba(0,0,0,.22);padding:6px;font-size:13px;line-height:1.5;z-index:9500;pointer-events:auto;animation:dsh-vpet-pop-x .15s ease-out}
.dsh-vpet-menu-item{padding:8px 12px;border-radius:9px;cursor:pointer;white-space:nowrap;transition:background .12s ease}
.dsh-vpet-menu-item:hover{background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.06))}
.dsh-vpet-menu-sep{height:1px;margin:5px 8px;background:var(--dsw-alias-border-l1,rgba(0,0,0,.08))}
.dsh-vpet-restore{position:fixed;right:24px;bottom:8px;z-index:9000;width:44px;height:44px;border-radius:50%;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#333);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));font-size:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.22);line-height:1;pointer-events:auto;transition:transform .12s ease}
.dsh-vpet-restore:hover{transform:scale(1.08)}
.dsh-vpet-chat{position:fixed;width:282px;max-height:384px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#333);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.24);padding:12px;z-index:9650;pointer-events:auto;color-scheme:light dark;animation:dsh-vpet-chat-in .18s ease-out}
.dsh-vpet-chat-head{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:600;padding-bottom:2px;cursor:grab;-webkit-user-select:none;user-select:none;touch-action:none}
.dsh-vpet-chat-head:active{cursor:grabbing}
.dsh-vpet-chat-close{cursor:pointer;color:var(--dsw-alias-label-secondary,#666);font-size:16px;line-height:1;padding:3px 8px;border-radius:6px;transition:background .12s ease}
.dsh-vpet-chat-close:hover{background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#333)}
.dsh-vpet-chat-log{display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;font-size:13px;line-height:1.55;padding:2px 2px 2px 0;scroll-behavior:smooth}
.dsh-vpet-chat-log::-webkit-scrollbar{width:6px}
.dsh-vpet-chat-log::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l1,rgba(0,0,0,.15));border-radius:3px}
.dsh-vpet-chat-msg{padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-break:break-word;max-width:85%;animation:dsh-vpet-msg-in .18s ease-out}
.dsh-vpet-chat-u{align-self:flex-end;background:var(--dsw-alias-brand-primary,#4a90d9);color:#fff;border-bottom-right-radius:4px}
.dsh-vpet-chat-a{align-self:flex-start;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#333);border-bottom-left-radius:4px}
.dsh-vpet-chat-row{display:flex;gap:8px;align-items:center}
.dsh-vpet-chat-input{flex:1;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.04));color:var(--dsw-alias-label-primary,#333);border-radius:12px;padding:8px 12px;font-size:13px;outline:none;min-width:0;transition:border-color .12s ease}
.dsh-vpet-chat-input:focus{border-color:var(--dsw-alias-brand-primary,#4a90d9)}
.dsh-vpet-chat-btn{border:none;background:var(--dsw-alias-brand-primary,#4a90d9);color:#fff;border-radius:12px;padding:8px 16px;font-size:13px;cursor:pointer;transition:opacity .12s ease}
.dsh-vpet-chat-btn:disabled{opacity:.45;cursor:default}
.dsh-vpet-settings{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:340px;max-height:82vh;overflow-y:auto;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#333);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.3);padding:16px;z-index:9700;pointer-events:auto;color-scheme:light dark;animation:dsh-vpet-settings-in .18s ease-out}
.dsh-vpet-settings::-webkit-scrollbar{width:8px}
.dsh-vpet-settings::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l1,rgba(0,0,0,.15));border-radius:4px}
.dsh-vpet-settings-head{display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:600;margin-bottom:10px;cursor:grab;-webkit-user-select:none;user-select:none;touch-action:none}
.dsh-vpet-settings-head:active{cursor:grabbing}
.dsh-vpet-settings-title{display:flex;align-items:center;gap:6px}
.dsh-vpet-settings-grip{color:var(--dsw-alias-label-secondary,#999);font-size:14px;letter-spacing:2px}
.dsh-vpet-settings-close{cursor:pointer;color:var(--dsw-alias-label-secondary,#666);font-size:16px;line-height:1;padding:3px 8px;border-radius:6px;transition:background .12s ease}
.dsh-vpet-settings-close:hover{background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#333)}
.dsh-vpet-sec-head{display:flex;align-items:center;gap:6px;padding:8px 10px;margin:2px 0;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;-webkit-user-select:none;user-select:none;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.04));transition:background .12s ease}
.dsh-vpet-sec-head:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.08))}
.dsh-vpet-sec-arrow{width:12px;color:var(--dsw-alias-label-secondary,#666);font-size:11px}
.dsh-vpet-sec-label{flex:1}
.dsh-vpet-sec-body{padding:2px 4px 6px 10px;border-left:2px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));margin-left:5px}
.dsh-vpet-settings-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0}
.dsh-vpet-settings-label{font-size:13px;line-height:1.4;white-space:nowrap}
.dsh-vpet-settings-row input[type=range]{flex:1;min-width:0;accent-color:var(--dsw-alias-brand-primary,#4a90d9)}
.dsh-vpet-settings-btn{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.04));color:var(--dsw-alias-label-primary,#333);border-radius:9px;padding:5px 12px;font-size:12px;cursor:pointer;transition:background .12s ease}
.dsh-vpet-settings-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.08))}
.dsh-vpet-settings-sep{height:1px;margin:10px 0;background:var(--dsw-alias-border-l1,rgba(0,0,0,.08))}
.dsh-vpet-settings-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#666);padding:4px 0}
.dsh-vpet-trash{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.dsh-vpet-trash-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0}
.dsh-vpet-trash-name{flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#666)}
.dsh-vpet-trash-actions{display:flex;gap:4px;flex-shrink:0}
.dsh-vpet-btn-danger{color:#e5484d;border-color:rgba(229,72,77,.4)}
.dsh-vpet-btn-danger:hover{background:rgba(229,72,77,.12)}
.dsh-vpet-name-row{display:flex;gap:6px;align-items:center;flex:1;min-width:0}
.dsh-vpet-name-input{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.04));color:var(--dsw-alias-label-primary,#333);border-radius:9px;padding:5px 10px;font-size:12px;outline:none;transition:border-color .12s ease}
.dsh-vpet-name-input:focus{border-color:var(--dsw-alias-brand-primary,#4a90d9)}
.dsh-vpet-status{position:fixed;right:16px;top:84px;width:240px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#333);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:16px;box-shadow:0 14px 44px rgba(0,0,0,.28);padding:14px;z-index:9750;pointer-events:auto;color-scheme:light dark;animation:dsh-vpet-settings-in .18s ease-out}
.dsh-vpet-status-head{display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:600;margin-bottom:10px;cursor:grab;-webkit-user-select:none;user-select:none;touch-action:none}
.dsh-vpet-status-head:active{cursor:grabbing}
.dsh-vpet-status-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0}
.dsh-vpet-status-k{font-size:12px;color:var(--dsw-alias-label-secondary,#666);white-space:nowrap}
.dsh-vpet-status-v{font-size:12px;font-weight:600;white-space:nowrap}
.dsh-vpet-status-track{flex:1;height:7px;border-radius:4px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.08));overflow:hidden;min-width:40px}
.dsh-vpet-status-fill{height:100%;border-radius:4px;transition:width .3s ease}
.dsh-vpet-status-sep{height:1px;margin:8px 0;background:var(--dsw-alias-border-l1,rgba(0,0,0,.08))}
.dsh-vpet-status-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px}
.dsh-vpet-status-grid span{font-size:12px;padding:5px 6px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.04));text-align:center}
.dsh-vpet-ach-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px}
.dsh-vpet-ach-item{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));text-align:center}
.dsh-vpet-ach-on{background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.04))}
.dsh-vpet-ach-off{opacity:.55}
.dsh-vpet-ach-icon{font-size:20px;line-height:1}
.dsh-vpet-ach-name{font-size:11px;line-height:1.2}
.dsh-vpet-ach-prog{font-size:10px;color:var(--dsw-alias-label-secondary,#666)}
.dsh-vpet-diarypanel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:340px;max-height:78vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#333);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.3);padding:16px;z-index:9700;pointer-events:auto;color-scheme:light dark;animation:dsh-vpet-settings-in .18s ease-out}
.dsh-vpet-diarypanel-head{display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:600;margin-bottom:10px;cursor:grab;-webkit-user-select:none;user-select:none;touch-action:none}
.dsh-vpet-diarypanel-head:active{cursor:grabbing}
.dsh-vpet-diarypanel-toolbar{display:flex;gap:6px;margin-bottom:12px}
.dsh-vpet-diarypanel-list{display:flex;flex-direction:column;gap:14px;overflow-y:auto;padding-right:4px;padding-bottom:4px;flex:1;min-height:0}
.dsh-vpet-diarypanel-list::-webkit-scrollbar{width:8px}
.dsh-vpet-diarypanel-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l1,rgba(0,0,0,.15));border-radius:4px}
.dsh-vpet-diarypanel-empty{font-size:13px;color:var(--dsw-alias-label-secondary,#666);text-align:center;padding:36px 14px;line-height:1.8;white-space:pre-wrap}
.dsh-vpet-diarycard{position:relative;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:14px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.02))}
.dsh-vpet-diarycard::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:2px;background:var(--dsw-alias-brand-primary,#4a90d9);opacity:.45}
.dsh-vpet-diarycard-date{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#666);margin-bottom:8px;letter-spacing:.3px}
.dsh-vpet-diarycard-text{font-size:13px;line-height:1.75;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#333)}
.dsh-vpet-mempanel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:340px;max-height:78vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#333);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.3);padding:16px;z-index:9700;pointer-events:auto;color-scheme:light dark;animation:dsh-vpet-settings-in .18s ease-out}
.dsh-vpet-mempanel-head{display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:600;margin-bottom:10px;cursor:grab;-webkit-user-select:none;user-select:none;touch-action:none}
.dsh-vpet-mempanel-head:active{cursor:grabbing}
.dsh-vpet-mem-add{display:flex;gap:6px;margin-bottom:12px}
.dsh-vpet-mem-select{flex-shrink:0;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.04));color:var(--dsw-alias-label-primary,#333);border-radius:9px;padding:5px 6px;font-size:12px;outline:none}
.dsh-vpet-mem-list{display:flex;flex-direction:column;gap:10px;overflow-y:auto;padding-right:4px;padding-bottom:4px;flex:1;min-height:0}
.dsh-vpet-mem-list::-webkit-scrollbar{width:8px}
.dsh-vpet-mem-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l1,rgba(0,0,0,.15));border-radius:4px}
.dsh-vpet-mem-empty{font-size:13px;color:var(--dsw-alias-label-secondary,#666);text-align:center;padding:36px 14px;line-height:1.8;white-space:pre-wrap}
.dsh-vpet-mem-item{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:12px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.02))}
.dsh-vpet-mem-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.dsh-vpet-mem-cat{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#666)}
.dsh-vpet-mem-del{flex-shrink:0;border:none;background:none;color:var(--dsw-alias-label-secondary,#999);font-size:12px;cursor:pointer;padding:2px 4px;border-radius:6px;line-height:1}
.dsh-vpet-mem-del:hover{background:rgba(229,72,77,.12);color:#e5484d}
.dsh-vpet-mem-content{font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#333)}
.dsh-vpet-achtoast{position:fixed;right:24px;bottom:150px;z-index:9800;display:flex;align-items:center;gap:8px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#333);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:14px;padding:10px 16px;font-size:13px;box-shadow:0 10px 32px rgba(0,0,0,.22);pointer-events:none;animation:dsh-vpet-toast-in .3s ease-out}
.dsh-vpet-achtoast-icon{font-size:22px;line-height:1}
.dsh-vpet-particle{position:absolute;bottom:12%;pointer-events:none;animation:dsh-vpet-rise 1.8s ease-out forwards}
.dsh-vpet-particle-dot{border-radius:50%}
.dsh-vpet-particle-emoji{line-height:1}
@keyframes dsh-vpet-rise{0%{opacity:0;transform:translateY(0) scale(.5)}15%{opacity:1}100%{opacity:0;transform:translateY(-150px) scale(1.15)}}
@keyframes dsh-vpet-pop-x{from{opacity:0;transform:translateX(-50%) translateY(8px) scale(.96)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
@keyframes dsh-vpet-chat-in{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes dsh-vpet-settings-in{from{opacity:0;transform:translate(-50%,-50%) scale(.95)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes dsh-vpet-msg-in{from{opacity:0;transform:translateY(5px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes dsh-vpet-toast-in{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}`

      const STORE_KEY = 'dsh.vpet.v1'
      function loadJson(key, fallback) {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            const v = window.localStorage.getItem(key)
            if (v != null) return JSON.parse(v)
          }
        } catch (err) {}
        return fallback
      }
      function saveJson(key, val) {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(key, JSON.stringify(val))
          }
        } catch (err) {}
      }
      function fetchJson(url, opts) {
        return fetch(url, opts).then((r) => {
          if (!r || r.status >= 400) {
            return Promise.reject(new Error('接口未就绪（HTTP ' + (r ? r.status : '?') + '），请重启 DSH'))
          }
          return r.text().then((t) => {
            if (!t || t.trim() === '') return Promise.reject(new Error('接口返回空，请重启 DSH'))
            try { return JSON.parse(t) } catch (err) { return Promise.reject(new Error('接口返回非 JSON，请重启 DSH')) }
          })
        })
      }
      function validScale(s) { return typeof s === 'number' && s >= 0.3 && s <= 1.2 }
      function fmtClock(sec) {
        const s = Math.max(0, Math.floor(sec))
        const m = Math.floor(s / 60)
        const r = s % 60
        return m + ':' + (r < 10 ? '0' : '') + r
      }
      function getPeriod() {
        const h = new Date().getHours()
        if (h >= 23 || h < 6) return 'night'
        if (h < 11) return 'morning'
        if (h < 18) return 'afternoon'
        return 'evening'
      }

      const saved0 = loadJson(STORE_KEY, {})
      let posRef = (saved0 && saved0.pos && typeof saved0.pos.x === 'number' && typeof saved0.pos.y === 'number') ? { x: saved0.pos.x, y: saved0.pos.y } : { x: 0, y: 0 }
      let facingRef = -1
      let movePlan = null
      let pressInfo = null
      let curDurMs = 2400
      let strokeState = null
      let lastSayMs = 0
      let lastClickMs = 0
      let longPressDisposer = null
      let mutedFlag = !!(saved0 && saved0.muted)
      let soundOn = false
      let hiddenFlag = !!(saved0 && saved0.hidden)
      let idleSinceMs = Date.now()
      let mouseX = null
      let mouseY = null
      let lastCareMs = Date.now()
      let sleepingFlag = false
      let focusFlag = false
      let focusEndsAt = null
      let focusStartMs = null
      let lastSitRemindMs = Date.now()
      let busyFlag = false
      let seenExecs = {}
      let taskBaselineDone = false
      let affinityFlag = (typeof saved0.affinity === 'number' && saved0.affinity >= 0 && saved0.affinity <= 100) ? saved0.affinity : 50
      let sassFlag = (typeof saved0.sass === 'number' && saved0.sass >= 0 && saved0.sass <= 100) ? saved0.sass : 60
      let moodRef = 'normal'
      let moodUntilMs = 0
      let pokeCount = 0
      let lastPokeMs = 0
      let periodRef = getPeriod()
      let greetedRef = ''
      function currentMood() {
        if (sleepingFlag) return 'sleepy'
        if (Date.now() < moodUntilMs) return moodRef
        return 'normal'
      }
      function setMoodTmp(m, ms) {
        moodRef = m
        moodUntilMs = Date.now() + ms
      }

      let nameFlag = (typeof saved0.name === 'string' && saved0.name.trim() !== '') ? saved0.name.trim().slice(0, 12) : ''

      const ACHIEVEMENTS = [
        { id: 'chat', icon: '💬', name: '打开话匣子', desc: '第一次和桌宠聊天', key: 'chat', need: 1 },
        { id: 'feed', icon: '🍩', name: '干饭人', desc: '第一次投喂', key: 'feed', need: 1 },
        { id: 'eat', icon: '🗑️', name: '大胃王', desc: '吃掉 10 个文件', key: 'eat', need: 10 },
        { id: 'poke', icon: '💢', name: '抗揍', desc: '被戳 50 次', key: 'poke', need: 50 },
        { id: 'pet', icon: '🖐️', name: '摸头杀', desc: '被摸 30 次', key: 'pet', need: 30 },
        { id: 'focus', icon: '🍅', name: '专注达人', desc: '完成一次番茄专注', key: 'focus', need: 1 },
        { id: 'night', icon: '🌙', name: '夜猫子', desc: '深夜还在陪它', key: 'night', need: 1 },
        { id: 'affinity', icon: '💖', name: '好感爆棚', desc: '好感度达到 100', key: 'affinity', need: 100 },
        { id: 'collector', icon: '🏅', name: '收藏家', desc: '解锁 5 个成就', key: 'unlocked', need: 5 }
      ]
      let achCounters = loadJson('dsh.vpet.ach.c', {})
      let achUnlocked = loadJson('dsh.vpet.ach.u', {})
      function saveAch() {
        saveJson('dsh.vpet.ach.c', achCounters)
        saveJson('dsh.vpet.ach.u', achUnlocked)
      }
      function achForId(id) {
        for (const a of ACHIEVEMENTS) if (a.id === id) return a
        return null
      }
      function achDone(id) { return !!achUnlocked[id] }
      function achVal(key) {
        if (key === 'affinity') return affinityFlag
        if (key === 'unlocked') return Object.keys(achUnlocked).length
        return (typeof achCounters[key] === 'number') ? achCounters[key] : 0
      }

      function todayStr() {
        const d = new Date()
        const p = (n) => (n < 10 ? '0' : '') + n
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      }
      let dayStats = loadJson('dsh.vpet.day', {})
      let pendingDiary = null
      function rollDay() {
        const t = todayStr()
        if (!dayStats || dayStats.date !== t) {
          const prev = dayStats
          dayStats = { date: t, chat: 0, feed: 0, pet: 0, eat: 0, poke: 0, focusMin: 0, taskDone: 0, taskFailed: 0, ssh: 0 }
          saveJson('dsh.vpet.day', dayStats)
          if (prev && prev.date && (prev.chat || prev.feed || prev.pet || prev.eat || prev.poke)) {
            pendingDiary = { date: prev.date, stats: prev }
          }
        }
        return dayStats
      }
      function bumpDay(key, n) {
        rollDay()
        dayStats[key] = (dayStats[key] || 0) + (n || 1)
        saveJson('dsh.vpet.day', dayStats)
      }
      function recordFocus() {
        if (focusStartMs) {
          const min = Math.max(1, Math.round((Date.now() - focusStartMs) / 60000))
          bumpDay('focusMin', min)
        }
        focusStartMs = null
      }
      let diaryRef = loadJson('dsh.vpet.diary', [])

      const FESTIVALS = {
        '01-01': '元旦',
        '02-14': '情人节',
        '05-01': '劳动节',
        '06-01': '儿童节',
        '10-01': '国庆节',
        '10-31': '万圣节',
        '12-24': '平安夜',
        '12-25': '圣诞节'
      }
      let waterOnFlag = (saved0 && saved0.waterOn === false) ? false : true
      let birthdayFlag = (typeof saved0.birthday === 'string') ? saved0.birthday.trim().slice(0, 5) : ''
      let lastWaterMs = loadJson('dsh.vpet.water', 0)
      let lastFestiveDate = loadJson('dsh.vpet.festive', '')
      let lastOvertimeMs = Date.now()
      let eggClickCount = 0
      let eggClickMs = 0
      let personalityFlag = (typeof saved0.personality === 'number' && saved0.personality >= 0 && saved0.personality <= 100) ? saved0.personality : 50
      let lastProactiveMs = Date.now()
      let lastAmbientSayMs = 0
      let memPendingCount = 0
      let memExtracting = false
      let reviewBusy = false

      let audioCtx = null
      let echoInput = null
      function getAudio() {
        if (typeof window === 'undefined') return null
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return null
        try {
          if (!audioCtx) audioCtx = new AC()
          if (audioCtx.state === 'suspended') audioCtx.resume()
        } catch (err) { return null }
        return audioCtx
      }
      function ensureEcho() {
        const ctx = getAudio()
        if (!ctx || echoInput) return echoInput
        try {
          const delay = ctx.createDelay(1)
          delay.delayTime.value = 0.3
          const fb = ctx.createGain()
          fb.gain.value = 0.3
          const wet = ctx.createGain()
          wet.gain.value = 0.3
          delay.connect(fb)
          fb.connect(delay)
          delay.connect(wet)
          wet.connect(ctx.destination)
          echoInput = delay
        } catch (err) { echoInput = null }
        return echoInput
      }
      function tone(freq, dur, delay, gain, type, echo) {
        const ctx = getAudio()
        if (!ctx) return
        const t0 = ctx.currentTime + (delay || 0)
        const release = 0.5
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.exponentialRampToValueAtTime(gain || 0.05, t0 + 0.04)
        g.gain.setValueAtTime(gain || 0.05, t0 + dur)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release)

        const osc = ctx.createOscillator()
        osc.type = type || 'triangle'
        osc.frequency.setValueAtTime(freq, t0)

        const sub = ctx.createOscillator()
        sub.type = 'sine'
        sub.frequency.setValueAtTime(freq * 1.004, t0)
        const sg = ctx.createGain()
        sg.gain.value = 0.2

        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = Math.min(freq * 5, 8000)
        filter.Q.value = 0.4

        osc.connect(g)
        sub.connect(sg)
        sg.connect(g)
        g.connect(filter)
        filter.connect(ctx.destination)

        if (echo) {
          const send = ctx.createGain()
          send.gain.value = 0.45
          g.connect(send)
          const bus = ensureEcho()
          if (bus) send.connect(bus)
        }

        osc.start(t0)
        sub.start(t0)
        osc.stop(t0 + dur + release + 0.1)
        sub.stop(t0 + dur + release + 0.1)
      }
      function beep(kind) {
        if (!soundOn || mutedFlag) return
        try {
          if (kind === 'click') { tone(659, 0.2, 0, 0.05, 'triangle'); tone(880, 0.18, 0.06, 0.04, 'sine') }
          else if (kind === 'pet') { tone(392, 0.55, 0, 0.05, 'sine'); tone(494, 0.55, 0.1, 0.035, 'sine') }
          else if (kind === 'feed') { tone(330, 0.22, 0, 0.05, 'triangle'); tone(392, 0.22, 0.14, 0.05, 'triangle'); tone(523, 0.32, 0.28, 0.05, 'triangle') }
          else if (kind === 'celebrate') { tone(523, 0.26, 0, 0.05, 'triangle', true); tone(659, 0.26, 0.14, 0.05, 'triangle', true); tone(784, 0.4, 0.28, 0.05, 'triangle', true); tone(1047, 0.5, 0.42, 0.04, 'sine', true) }
          else if (kind === 'longpress') { tone(220, 0.55, 0, 0.05, 'sine'); tone(277, 0.5, 0.1, 0.03, 'sine') }
          else if (kind === 'eat') { tone(587, 0.2, 0, 0.05, 'triangle'); tone(740, 0.2, 0.12, 0.05, 'triangle'); tone(880, 0.4, 0.24, 0.045, 'sine', true) }
          else if (kind === 'wake') { tone(440, 0.45, 0, 0.05, 'sine'); tone(550, 0.45, 0.16, 0.045, 'sine'); tone(660, 0.5, 0.32, 0.04, 'sine') }
          else if (kind === 'drag') { tone(392, 0.35, 0, 0.035, 'triangle') }
        } catch (err) {}
      }

      function pick(pool, exclude) {
        if (!pool || pool.length === 0) return null
        let i = Math.floor(Math.random() * pool.length)
        if (exclude != null && pool.length > 1 && pool[i] === exclude) i = (i + 1) % pool.length
        return pool[i]
      }

      function detectTaskEvent() {
        try {
          if (typeof window === 'undefined' || !window.localStorage) return null
          const raw = window.localStorage.getItem('dsh.taskBoard.v1')
          if (!raw) return null
          const tasks = JSON.parse(raw)
          if (!Array.isArray(tasks)) return null
          const settled = (ex) => ex && typeof ex.id === 'string' && (ex.result === 'succeeded' || ex.result === 'failed')
          if (!taskBaselineDone) {
            for (const t of tasks) {
              if (t && Array.isArray(t.executions)) for (const ex of t.executions) if (settled(ex)) seenExecs[ex.id] = true
            }
            taskBaselineDone = true
            return null
          }
          for (const t of tasks) {
            if (!t || !Array.isArray(t.executions)) continue
            for (const ex of t.executions) {
              if (settled(ex) && !seenExecs[ex.id]) {
                seenExecs[ex.id] = true
                const title = typeof t.title === 'string' ? t.title : ''
                return { kind: ex.result === 'succeeded' ? 'task-done' : 'task-failed', title: title }
              }
            }
          }
          return null
        } catch (err) { return null }
      }

      function VideoPet() {
        const [anim, setAnim] = React.useState(CAT.idle)
        const [animKey, setAnimKey] = React.useState(0)
        const [facing, setFacing] = React.useState(-1)
        const [pos, setPos] = React.useState(posRef)
        const [dragging, setDragging] = React.useState(false)
        const [failed, setFailed] = React.useState(false)
        const [bubble, setBubble] = React.useState(null)
        const [bubbleText, setBubbleText] = React.useState('')
        const [scale, setScale] = React.useState(validScale(saved0 && saved0.scale) ? saved0.scale : 0.5)
        const [muted, setMuted] = React.useState(mutedFlag)
        const [hidden, setHidden] = React.useState(hiddenFlag)
        const [menu, setMenu] = React.useState(null)
        const [sleeping, setSleeping] = React.useState(false)
        const [focusing, setFocusing] = React.useState(false)
        const [focusLeft, setFocusLeft] = React.useState(null)
        const [affinity, setAffinity] = React.useState(affinityFlag)
        const [sass, setSass] = React.useState(sassFlag)
        const [chatOpen, setChatOpen] = React.useState(false)
        const [chatText, setChatText] = React.useState('')
        const [chatHistory, setChatHistory] = React.useState(loadJson('dsh.vpet.chat', []))
        const [particles, setParticles] = React.useState([])
        const [settingsOpen, setSettingsOpen] = React.useState(false)
        const [trashList, setTrashList] = React.useState(null)
        const [chatBusy, setChatBusy] = React.useState(false)
        const [petName, setPetName] = React.useState(nameFlag)
        const [nameDraft, setNameDraft] = React.useState(nameFlag)
        const [achTick, setAchTick] = React.useState(0)
        const [achToast, setAchToast] = React.useState(null)
        const [diaryList, setDiaryList] = React.useState(Array.isArray(diaryRef) ? diaryRef.slice() : [])
        const [diaryBusy, setDiaryBusy] = React.useState(false)
        const [settingsPos, setSettingsPos] = React.useState(null)
        const [statusPos, setStatusPos] = React.useState(null)
        const [chatPos, setChatPos] = React.useState(null)
        const [waterOn, setWaterOn] = React.useState(waterOnFlag)
        const [birthday, setBirthday] = React.useState(birthdayFlag)
        const [birthdayDraft, setBirthdayDraft] = React.useState(birthdayFlag)
        const [personality, setPersonality] = React.useState(personalityFlag)
        const [statusOpen, setStatusOpen] = React.useState(false)
        const [secOpen, setSecOpen] = React.useState({ base: true, persona: true, grow: false, data: false })
        const [diaryOpen, setDiaryOpen] = React.useState(false)
        const [diaryPos, setDiaryPos] = React.useState(null)
        const [memOpen, setMemOpen] = React.useState(false)
        const [memPos, setMemPos] = React.useState(null)
        const [memList, setMemList] = React.useState([])
        const [memDraft, setMemDraft] = React.useState('')
        const [memCat, setMemCat] = React.useState('goal')
        const [memBusy, setMemBusy] = React.useState(false)
        const fileInputRef = React.useRef(null)
        const bubbleShownRef = React.useRef(false)

        const anchorRef = React.useRef(null)
        const chatLogRef = React.useRef(null)

        const VW = Math.round(640 * scale)
        const VH = Math.round(360 * scale)

        const vw = (typeof window !== 'undefined' && typeof window.innerWidth === 'number') ? window.innerWidth : 1200
        const vh = (typeof window !== 'undefined' && typeof window.innerHeight === 'number') ? window.innerHeight : 800
        const minX = -(vw - 24 - VW)
        const maxX = 24
        const minY = -(vh - 8 - VH)
        const maxY = 8
        const clampX = (v) => {
          const w = (typeof window !== 'undefined' && typeof window.innerWidth === 'number') ? window.innerWidth : 1200
          return Math.max(-(w - 24 - VW), Math.min(24, v))
        }
        const clampY = (v) => {
          const h = (typeof window !== 'undefined' && typeof window.innerHeight === 'number') ? window.innerHeight : 800
          return Math.max(-(h - 8 - VH), Math.min(8, v))
        }

        const commitPos = (x, y) => {
          posRef = { x: Math.round(x), y: Math.round(y) }
          setPos(posRef)
        }
        const commitFacing = (f) => {
          facingRef = f
          setFacing(f)
        }

        const playAnim = (name) => {
          movePlan = null
          setFailed(false)
          setAnim(name)
          setAnimKey(k => k + 1)
        }

        const say = (mode, topic) => {
          if (mutedFlag || hiddenFlag || sleepingFlag || focusFlag) return
          const now = Date.now()
          if (now - lastSayMs < 1000) return
          lastSayMs = now
          const payload = { mode: mode || 'auto', affinity: affinityFlag, sass: sassFlag, mood: currentMood(), name: nameFlag, personality: personalityFlag }
          if (typeof topic === 'string' && topic !== '') payload.topic = topic
          fetchJson('/dsh-pet/api/say', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
          }).then((r) => {
            if (r && typeof r.affinity === 'number') { affinityFlag = r.affinity; setAffinity(r.affinity); checkSpecials() }
            if (r && r.ok && r.text) setBubble({ text: r.text, ts: Date.now() })
            else if (r && r.diag) setBubble({ text: '🐛 ' + r.diag, ts: Date.now() })
          }).catch((e) => setBubble({ text: '❌ ' + (e && e.message ? e.message : String(e)), ts: Date.now() }))
        }

        // 主动/环境类吐槽的统一节流：避免自动、事件、主动搭话等多个触发器短时间内叠成一串气泡。
        // 交互类（点击/抚摸/投喂/拖拽/聊天）仍直接走 say()，保持即时反馈。
        const sayAmbient = (mode, topic) => {
          const now = Date.now()
          if (now - lastAmbientSayMs < 45 * 1000) return false
          lastAmbientSayMs = now
          say(mode, topic)
          return true
        }

        const extractMemory = (history) => {
          if (memExtracting) return
          memExtracting = true
          fetchJson('/dsh-pet/api/memory', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ history: history, name: nameFlag })
          }).then((r) => {
            memExtracting = false
            if (r && r.ok && r.added > 0) setBubble({ text: '🧠 我记住啦：' + r.added + ' 件关于你的事', ts: Date.now() })
          }).catch(() => { memExtracting = false })
        }

        const generateReview = () => {
          if (reviewBusy) return
          reviewBusy = true
          const stats = rollDay()
          fetchJson('/dsh-pet/api/review', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: nameFlag, date: stats.date, stats: stats })
          }).then((r) => {
            reviewBusy = false
            if (r && r.ok && r.review) { setBubble({ text: '📋 ' + r.review, ts: Date.now() }) }
            else setBubble({ text: '🐛 ' + (r && r.diag ? r.diag : '复盘失败'), ts: Date.now() })
          }).catch((e) => { reviewBusy = false; setBubble({ text: '❌ ' + (e && e.message ? e.message : String(e)), ts: Date.now() }) })
        }

        const sendChat = () => {
          const text = chatText.trim()
          if (!text || chatBusy) return
          setChatText('')
          setChatBusy(true)
          bumpAch('chat', 1)
          bumpDay('chat', 1)
          touchNight()
          shiftPersonality(0.5)
          if (/喜欢|爱你|爱你哦|爱死你|亲爱的|么么哒/.test(text)) {
            playAnim('点击回应 - 害羞惊讶')
            spawnParticles(['💕', '💗', '💘', '😳'], 16, ['#ff6b9d', '#ff8fab', '#ffc2d1'])
            say('egg-love')
          }
          const base = Array.isArray(chatHistory) ? chatHistory : []
          const payload = { text: text, history: base, name: nameFlag, personality: personalityFlag }
          fetchJson('/dsh-pet/api/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
          }).then((r) => {
            setChatBusy(false)
            const nh = base.concat([{ role: 'user', text: text }])
            if (r && r.ok && r.text) nh.push({ role: 'assistant', text: r.text })
            const trimmed = nh.slice(-20)
            setChatHistory(trimmed)
            saveJson('dsh.vpet.chat', trimmed)
            memPendingCount += 1
            if (memPendingCount >= 3) {
              memPendingCount = 0
              extractMemory(trimmed)
            }
            if (r && r.ok && r.text) setBubble({ text: r.text, ts: Date.now() })
            else if (r && r.diag) setBubble({ text: '🐛 ' + r.diag, ts: Date.now() })
          }).catch((e) => { setChatBusy(false); setBubble({ text: '❌ ' + (e && e.message ? e.message : String(e)), ts: Date.now() }) })
        }

        const spawnParticles = (emojis, count, colors) => {
          const batchId = Date.now() + '-' + Math.random()
          const batch = []
          for (let i = 0; i < count; i++) {
            const useDot = colors && Math.random() < 0.45
            batch.push({
              id: batchId + '-' + i,
              dot: useDot ? colors[i % colors.length] : null,
              emoji: useDot ? null : emojis[i % emojis.length],
              x: 8 + Math.random() * 84,
              delay: Math.random() * 450,
              size: 12 + Math.random() * 14
            })
          }
          setParticles((prev) => prev.concat(batch))
          timer.timeout(() => {
            setParticles((prev) => prev.filter((p) => batch.indexOf(p) === -1))
          }, 2400)
        }

        const celebrateAch = (a) => {
          if (!a) return
          playAnim(CAT.celebrate)
          spawnParticles(['🏅', '✨', '💫'], 14, ['#ffd166', '#ffe08a', '#fff3b0'])
          beep('celebrate')
          setAchToast({ icon: a.icon, name: a.name, id: a.id })
          say('achievement', a.name)
        }

        const checkSpecials = () => {
          let changed = false
          const aAff = achForId('affinity')
          if (aAff && !achDone('affinity') && affinityFlag >= aAff.need) { achUnlocked['affinity'] = Date.now(); changed = true; celebrateAch(aAff) }
          const aCol = achForId('collector')
          if (aCol && !achDone('collector') && Object.keys(achUnlocked).length >= aCol.need) { achUnlocked['collector'] = Date.now(); changed = true; celebrateAch(aCol) }
          if (changed) { saveAch(); setAchTick((t) => t + 1) }
        }

        const bumpAch = (key, n) => {
          if (key === 'affinity' || key === 'unlocked') return
          const add = (typeof n === 'number') ? n : 1
          achCounters[key] = (typeof achCounters[key] === 'number' ? achCounters[key] : 0) + add
          saveAch()
          const newly = []
          for (const a of ACHIEVEMENTS) {
            if (a.key === key && !achDone(a.id) && achVal(a.key) >= a.need) newly.push(a)
          }
          if (newly.length) {
            for (const a of newly) achUnlocked[a.id] = Date.now()
            saveAch()
            setAchTick((t) => t + 1)
            for (const a of newly) celebrateAch(a)
            checkSpecials()
          }
        }

        const touchNight = () => { if (getPeriod() === 'night') bumpAch('night', 1) }

        const writeDiary = (date, stats) => {
          setDiaryBusy(true)
          fetchJson('/dsh-pet/api/diary', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: nameFlag, date: date, stats: stats })
          }).then((r) => {
            setDiaryBusy(false)
            if (r && r.ok && r.diary) {
              const list = Array.isArray(diaryRef) ? diaryRef.slice() : []
              const filtered = list.filter((e) => !e || e.date !== date)
              filtered.unshift({ date: date, text: r.diary })
              diaryRef = filtered.slice(0, 30)
              saveJson('dsh.vpet.diary', diaryRef)
              setDiaryList(diaryRef.slice())
              setBubble({ text: '📔 日记写好啦', ts: Date.now() })
            } else {
              setBubble({ text: '🐛 ' + (r && r.diag ? r.diag : '日记失败'), ts: Date.now() })
            }
          }).catch((e) => { setDiaryBusy(false); setBubble({ text: '❌ ' + (e && e.message ? e.message : String(e)), ts: Date.now() }) })
        }

        const chainNext = (justFinished) => {
          if (sleepingFlag) { playAnim(CAT.sleep); return }
          if (Date.now() - idleSinceMs > 8 * 60 * 1000 && !busyFlag) {
            sleepingFlag = true
            setSleeping(true)
            playAnim(CAT.sleep)
            return
          }
          const roll = Math.random()
          if (roll < 0.30) { playAnim(CAT.idle); return }
          if (roll < 0.40) { playAnim(CAT.turn); return }
          if (roll < 0.80) { playAnim(pick(CAT.acts, justFinished)); return }
          const dist = 60 + Math.round(180 * Math.random())
          let dir = facingRef
          if (typeof mouseX === 'number' && !isNaN(mouseX)) {
            const w = (typeof window !== 'undefined' && typeof window.innerWidth === 'number') ? window.innerWidth : 1200
            const petCx = w - 24 - VW / 2 + posRef.x
            dir = (mouseX >= petCx) ? 1 : -1
          }
          if (dir !== facingRef) commitFacing(dir)
          const targetX = posRef.x + dir * dist
          if (targetX < minX || targetX > maxX) {
            playAnim(pick(CAT.acts, justFinished)); return
          }
          const moveName = pick(CAT.moves, null)
          playAnim(moveName)
          movePlan = { startX: posRef.x, targetX, startMs: Date.now(), durMs: curDurMs, leadMs: 2000, tailMs: 2000 }
        }

        const onEnded = () => {
          if (movePlan) {
            const tx = movePlan.targetX
            movePlan = null
            commitPos(tx, posRef.y)
          }
          const done = anim
          if (done === CAT.drag) { playAnim(CAT.idle); return }
          if (done === CAT.turn) { commitFacing(-facingRef) }
          if (CAT.clicks.indexOf(done) >= 0) { playAnim(CAT.idle); return }
          chainNext(done)
        }

        React.useEffect(() => {
          return timer.interval(() => {
            if (!movePlan) return
            const t = Date.now() - movePlan.startMs
            let x = movePlan.startX
            if (t >= movePlan.durMs - movePlan.tailMs) {
              x = movePlan.targetX
              movePlan = null
            } else if (t > movePlan.leadMs) {
              const mid = Math.max(0.1, movePlan.durMs - movePlan.leadMs - movePlan.tailMs)
              const p = (t - movePlan.leadMs) / mid
              x = movePlan.startX + (movePlan.targetX - movePlan.startX) * p
            }
            commitPos(clampX(x), posRef.y)
          }, 40)
        }, [scale])

        React.useEffect(() => {
          const first = timer.timeout(() => {
            const idle = Date.now() - idleSinceMs
            sayAmbient(idle > 3 * 60 * 1000 ? 'lonely' : 'auto')
          }, 4000)
          const loop = timer.interval(() => {
            if (Math.random() < 0.5) return
            const idle = Date.now() - idleSinceMs
            sayAmbient(idle > 3 * 60 * 1000 ? 'lonely' : 'auto')
          }, 300000)
          return () => { if (first) first(); if (loop) loop() }
        }, [])

        React.useEffect(() => {
          const poll = timer.interval(() => {
            fetchJson('/dsh-pet/api/check').then((r) => {
              if (r && typeof r.busy === 'boolean') busyFlag = r.busy
              if (r && r.event === 'assistant') sayAmbient('assistant')
              else if (r && r.event === 'user') sayAmbient('user')
              if (r && r.ssh) { bumpDay('ssh', 1); sayAmbient('ssh', r.ssh) }
            }).catch(() => {})
            const taskEv = detectTaskEvent()
            if (taskEv) { bumpDay(taskEv.kind === 'task-done' ? 'taskDone' : 'taskFailed', 1); sayAmbient(taskEv.kind, taskEv.title) }
          }, 15000)
          return () => { if (poll) poll() }
        }, [])

        React.useEffect(() => {
          const check = timer.interval(() => {
            if (mutedFlag || hiddenFlag || sleepingFlag || focusFlag) return
            if (Date.now() - lastSitRemindMs > 50 * 60 * 1000) {
              lastSitRemindMs = Date.now()
              playAnim(CAT.stretch)
              say('sitting')
            }
          }, 60000)
          return () => { if (check) check() }
        }, [])

        React.useEffect(() => {
          const care = timer.interval(() => {
            if (mutedFlag || hiddenFlag || sleepingFlag || focusFlag) return
            if (Date.now() - lastCareMs > 40 * 60 * 1000) {
              lastCareMs = Date.now()
              say('tired')
            }
          }, 5 * 60 * 1000)
          return () => { if (care) care() }
        }, [])

        React.useEffect(() => {
          const ambient = timer.interval(() => {
            if (mutedFlag || hiddenFlag || sleepingFlag || focusFlag) return
            if (Math.random() < 0.65) {
              spawnParticles(['✨'], 1 + Math.floor(Math.random() * 2), ['#ffffff', '#fff3b0', '#ffd6e8', '#d0bfff'])
            }
          }, 7000)
          return () => { if (ambient) ambient() }
        }, [])

        React.useEffect(() => {
          const onMove = (e) => {
            mouseX = e.clientX
            mouseY = e.clientY
            if (hiddenFlag || sleepingFlag || movePlan || (pressInfo && pressInfo.moved)) return
            const el = anchorRef.current
            if (!el) return
            const rect = el.getBoundingClientRect()
            if (!rect || rect.width < 1 || rect.height < 1) return
            const cx = rect.left + rect.width / 2
            const cy = rect.top + rect.height / 2
            const dx = e.clientX - cx
            const dy = e.clientY - cy
            const nf = dx >= 0 ? 1 : -1
            if (nf !== facingRef) {
              facingRef = nf
              setFacing(nf)
            }
            const tilt = Math.max(-6, Math.min(6, -dy / 70))
            el.style.setProperty('--dsh-tilt', tilt.toFixed(2) + 'deg')
          }
          window.addEventListener('mousemove', onMove)
          return () => window.removeEventListener('mousemove', onMove)
        }, [])

        React.useEffect(() => {
          const tick = timer.interval(() => {
            const p = getPeriod()
            if (p !== periodRef) {
              const prev = periodRef
              periodRef = p
              if (prev === 'night' && sleepingFlag) {
                sleepingFlag = false
                setSleeping(false)
              }
              const greet = { morning: 'good-morning', afternoon: 'good-afternoon', evening: 'good-evening', night: 'good-night' }[p]
              if (greet && greetedRef !== p) {
                greetedRef = p
                say(greet)
              }
            }
            if (p === 'night' && !sleepingFlag && !focusFlag && !(pressInfo && pressInfo.moved) && Date.now() - idleSinceMs > 3 * 60 * 1000) {
              sleepingFlag = true
              setSleeping(true)
              playAnim(CAT.sleep)
            }
          }, 60000)
          return () => { if (tick) tick() }
        }, [])

        React.useEffect(() => {
          const tick = timer.interval(() => {
            rollDay()
            if (pendingDiary) {
              const pd = pendingDiary
              pendingDiary = null
              writeDiary(pd.date, pd.stats)
            }
          }, 60000)
          return () => { if (tick) tick() }
        }, [])

        React.useEffect(() => {
          const tick = timer.interval(() => {
            const t = todayStr()
            if (lastFestiveDate === t) return
            lastFestiveDate = t
            saveJson('dsh.vpet.festive', lastFestiveDate)
            const mmdd = t.slice(5)
            if (birthdayFlag && birthdayFlag === mmdd) say('birthday')
            else if (FESTIVALS[mmdd]) say('festival', FESTIVALS[mmdd])
          }, 60000)
          return () => { if (tick) tick() }
        }, [])

        React.useEffect(() => {
          const tick = timer.interval(() => {
            if (!waterOnFlag || mutedFlag || hiddenFlag || sleepingFlag || focusFlag) return
            const h = new Date().getHours()
            if (h < 8 || h >= 23) return
            if (Date.now() - lastWaterMs < 60 * 60 * 1000) return
            lastWaterMs = Date.now()
            saveJson('dsh.vpet.water', lastWaterMs)
            spawnParticles(['💧'], 4, ['#a0c4ff', '#8ecae6'])
            say('water')
          }, 5 * 60 * 1000)
          return () => { if (tick) tick() }
        }, [])

        React.useEffect(() => {
          const tick = timer.interval(() => {
            const h = new Date().getHours()
            if (h < 22 && h >= 5) return
            if (mutedFlag || hiddenFlag || sleepingFlag || focusFlag) return
            if (!busyFlag) return
            if (Date.now() - lastOvertimeMs < 60 * 60 * 1000) return
            lastOvertimeMs = Date.now()
            say('overtime')
          }, 10 * 60 * 1000)
          return () => { if (tick) tick() }
        }, [])

        React.useEffect(() => {
          const tick = timer.interval(() => {
            if (mutedFlag || hiddenFlag || sleepingFlag || focusFlag) return
            if (Date.now() - idleSinceMs < 6 * 60 * 1000) return
            if (Date.now() - lastProactiveMs < 25 * 60 * 1000) return
            lastProactiveMs = Date.now()
            sayAmbient('proactive')
          }, 60 * 1000)
          return () => { if (tick) tick() }
        }, [])

        React.useEffect(() => {
          let lastWorkMs = Date.now()
          let lastDigestDate = loadJson('dsh.vpet.memdigest', '')
          const doWork = () => {
            fetchJson('/dsh-pet/api/memory/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => {
              if (r && r.ok && r.added > 0) setBubble({ text: '🧠 记住你刚才在做的事：' + r.added + ' 件', ts: Date.now() })
            }).catch(() => {})
          }
          const tick = timer.interval(() => {
            const now = new Date()
            const h = now.getHours()
            const today = todayStr()
            if (h >= 8 && h < 23 && Date.now() - lastWorkMs >= 15 * 60 * 1000) {
              lastWorkMs = Date.now()
              doWork()
            }
            if (h >= 20 && lastDigestDate !== today) {
              lastDigestDate = today
              saveJson('dsh.vpet.memdigest', today)
              doWork()
              setBubble({ text: '🌙 睡前把今天的记忆整理了一下', ts: Date.now() })
            }
          }, 60 * 1000)
          return () => { if (tick) tick() }
        }, [])

        React.useEffect(() => {
          let lastReviewDate = loadJson('dsh.vpet.review', '')
          const tick = timer.interval(() => {
            const h = new Date().getHours()
            const today = todayStr()
            if (h >= 21 && lastReviewDate !== today) {
              lastReviewDate = today
              saveJson('dsh.vpet.review', today)
              generateReview()
            }
          }, 60 * 1000)
          return () => { if (tick) tick() }
        }, [])

        React.useEffect(() => {
          if (!achToast) return
          return timer.timeout(() => setAchToast(null), 3500)
        }, [achToast])

        React.useEffect(() => {
          if (!chatOpen || chatPos) return
          const el = anchorRef.current
          if (!el) return
          const r = el.getBoundingClientRect()
          const w = (typeof window !== 'undefined' && typeof window.innerWidth === 'number') ? window.innerWidth : 1200
          const cx = Math.max(8, Math.min(r.left + r.width / 2 - 141, w - 298))
          const cy = Math.max(8, r.top - 360)
          setChatPos({ x: cx, y: cy })
        }, [chatOpen, chatPos])

        React.useEffect(() => {
          if (!focusing) return
          const tick = timer.interval(() => {
            const left = Math.max(0, Math.round((focusEndsAt - Date.now()) / 1000))
            setFocusLeft(left)
            if (left <= 0) {
              focusFlag = false
              focusEndsAt = null
              recordFocus()
              setFocusing(false)
              setFocusLeft(null)
              playAnim(CAT.celebrate)
              bumpAch('focus', 1)
              say('focus-done')
            }
          }, 1000)
          return () => { if (tick) tick() }
        }, [focusing])

        React.useEffect(() => {
          if (!bubble) return
          return timer.timeout(() => setBubble(null), 12000)
        }, [bubble])

        React.useEffect(() => {
          if (!bubble) {
            bubbleShownRef.current = false
            setBubbleText('')
            return
          }
          const full = bubble.text || ''
          // 已经有气泡在显示时，直接整段替换文本，避免清空重打造成的「一下显示一下消失」闪烁；
          // 只有从无气泡 → 有气泡的第一次才播放逐字打字动画。
          if (bubbleShownRef.current) {
            setBubbleText(full)
            return
          }
          bubbleShownRef.current = true
          let i = 0
          setBubbleText('')
          const iv = timer.interval(() => {
            i += 2
            setBubbleText(full.slice(0, i))
            if (i >= full.length && iv) iv()
          }, 22)
          return () => { if (iv) iv() }
        }, [bubble])

        React.useEffect(() => {
          const el = chatLogRef.current
          if (el) el.scrollTop = el.scrollHeight
        }, [chatHistory])

        React.useEffect(() => {
          commitPos(clampX(posRef.x), clampY(posRef.y))
        }, [scale])

        React.useEffect(() => {
          const onResize = () => { commitPos(clampX(posRef.x), clampY(posRef.y)) }
          if (typeof window !== 'undefined') window.addEventListener('resize', onResize)
          return () => { if (typeof window !== 'undefined') window.removeEventListener('resize', onResize) }
        }, [])

        React.useEffect(() => {
          persistPet()
        }, [pos, scale, muted, hidden, affinity, sass, personality])

        const onPointerDown = (e) => {
          idleSinceMs = Date.now()
          setMenu(null)
          if (sleepingFlag) {
            sleepingFlag = false
            setSleeping(false)
            playAnim(CAT.wake)
            say('wake')
            beep('wake')
            spawnParticles(['💤', '✨'], 8, ['#a0c4ff', '#fff3b0'])
            return
          }
          if (e.currentTarget && e.currentTarget.setPointerCapture) {
            try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
          }
          movePlan = null
          pressInfo = { sx: e.clientX, sy: e.clientY, bx: posRef.x, by: posRef.y, moved: false }
          if (longPressDisposer) { longPressDisposer(); longPressDisposer = null }
          longPressDisposer = timer.timeout(() => {
            if (pressInfo && !pressInfo.moved && !sleepingFlag) {
              pressInfo.longPressed = true
              playAnim(CAT.stretch)
              say('long-press')
              beep('longpress')
            }
          }, 600)
        }
        const onPointerMove = (e) => {
          if (pressInfo) {
            const dx = e.clientX - pressInfo.sx
            const dy = e.clientY - pressInfo.sy
            if (!pressInfo.moved) {
              if (Math.abs(dx) + Math.abs(dy) < 6) return
              pressInfo.moved = true
              if (longPressDisposer) { longPressDisposer(); longPressDisposer = null }
              setDragging(true)
              playAnim(CAT.drag)
            }
            commitPos(clampX(pressInfo.bx + dx), clampY(pressInfo.by + dy))
            return
          }
          const now = Date.now()
          if (!strokeState || now - strokeState.lastT > 2000) {
            strokeState = { lastX: e.clientX, lastDir: 0, revs: 0, lastT: now, fired: false }
            return
          }
          const dx = e.clientX - strokeState.lastX
          if (Math.abs(dx) < 12) return
          const dir = dx > 0 ? 1 : -1
          if (strokeState.lastDir !== 0 && dir !== strokeState.lastDir) {
            strokeState.revs++
            strokeState.lastT = now
          }
          strokeState.lastDir = dir
          strokeState.lastX = e.clientX
          if (strokeState.revs >= 2 && !strokeState.fired) {
            strokeState.fired = true
            idleSinceMs = Date.now()
            playAnim(pick(CAT.clicks, null))
            setMoodTmp('happy', 20000)
            bumpAch('pet', 1)
            bumpDay('pet', 1)
            touchNight()
            shiftPersonality(0.5)
            say('pet')
            beep('pet')
            spawnParticles(['💕', '💖'], 6, ['#ff8fab', '#ffc2d1'])
          }
        }
        const onPointerUp = (e) => {
          if (longPressDisposer) { longPressDisposer(); longPressDisposer = null }
          const wasMoved = !!(pressInfo && pressInfo.moved)
          const wasLongPress = !!(pressInfo && pressInfo.longPressed)
          pressInfo = null
          if (wasMoved) {
            setDragging(false)
            playAnim(CAT.idle)
            shiftPersonality(-0.5)
            say('drag')
            beep('drag')
            spawnParticles(['💨'], 6, ['#bdb2ff', '#c3f0ca', '#a0c4ff'])
          } else if (wasLongPress) {
            playAnim(CAT.idle)
          } else if (anim === CAT.idle) {
            const now = Date.now()
            if (now - lastClickMs < 350) {
              lastClickMs = 0
              playAnim(CAT.celebrate)
              spawnParticles(['⭐', '✨', '💫'], 12, ['#ffd166', '#ffe08a', '#fff3b0', '#ffd6e8'])
              setMoodTmp('happy', 15000)
              say('double-click')
              beep('celebrate')
            } else {
              lastClickMs = now
              const nowEgg = Date.now()
              eggClickCount = (nowEgg - eggClickMs < 3000) ? eggClickCount + 1 : 1
              eggClickMs = nowEgg
              if (eggClickCount >= 10) {
                eggClickCount = 0
                playAnim('原地左转奔跑')
                spawnParticles(['💢', '💥', '🔥', '⭐'], 20, ['#ff6b6b', '#ffa94d', '#ffd166'])
                say('egg-poke')
                beep('click')
              }
              const hourEgg = new Date().getHours()
              if (hourEgg >= 2 && hourEgg < 4 && Date.now() - lastSayMs > 3000) {
                say('egg-night')
              }
              let ry = 0.5
              if (e && e.currentTarget) {
                const rect = e.currentTarget.getBoundingClientRect()
                ry = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5
              }
              if (ry < 0.33) {
                playAnim('点击回应 - 害羞惊讶')
                spawnParticles(['❤️', '💕', '💖'], 10, ['#ff6b9d', '#ff8fab', '#ffc2d1'])
                setMoodTmp('happy', 20000)
                bumpAch('pet', 1)
                bumpDay('pet', 1)
                touchNight()
                shiftPersonality(0.5)
                say('pet', '摸头')
                beep('pet')
              } else if (ry > 0.67) {
                playAnim('原地左转奔跑')
                spawnParticles(['✨', '💫', '⭐'], 10, ['#ffd166', '#fff3b0', '#ffe08a'])
                setMoodTmp('happy', 20000)
                bumpAch('pet', 1)
                bumpDay('pet', 1)
                touchNight()
                shiftPersonality(0.5)
                say('pet', '摸尾巴')
                beep('pet')
              } else {
                playAnim(pick(CAT.clicks, null))
                const nowP = Date.now()
                pokeCount = (nowP - lastPokeMs < 2000) ? pokeCount + 1 : 1
                lastPokeMs = nowP
                if (pokeCount >= 4) setMoodTmp('angry', 15000)
                bumpAch('poke', 1)
                bumpDay('poke', 1)
                touchNight()
                shiftPersonality(-0.5)
                say('roast')
                beep('click')
                spawnParticles(['💢', '🔥'], 7, ['#ff6b6b', '#ffa94d'])
              }
            }
          }
        }
        const onContextMenu = (e) => {
          if (e.preventDefault) e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
          return false
        }
        const eatFile = (f) => {
          playAnim('吃Token')
          spawnParticles(['📄', '🍽️', '✨'], 12, ['#a0c4ff', '#bdb2ff', '#ffd6a5'])
          const payload = { name: f.name }
          if (typeof f.size === 'number') payload.size = f.size
          fetchJson('/dsh-pet/api/eat-file', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
          }).then((r) => {
            if (r && r.ok && r.removed) {
              playAnim(CAT.celebrate)
              beep('eat')
              bumpAch('eat', 1)
              bumpDay('eat', 1)
              setBubble({ text: '嗝～吃掉啦 ' + r.removed + ' 🍽️', ts: Date.now() })
            } else {
              setBubble({ text: '🐛 ' + (r && r.diag ? r.diag : '没吃到'), ts: Date.now() })
            }
          }).catch((e) => setBubble({ text: '❌ ' + (e && e.message ? e.message : String(e)), ts: Date.now() }))
        }
        const processDrop = (dt) => {
          let f = null
          if (dt && dt.files && dt.files.length > 0) {
            const f0 = dt.files[0]
            if (f0 && f0.name) f = { name: f0.name, size: (typeof f0.size === 'number') ? f0.size : null }
          } else {
            let txt = ''
            try { txt = dt ? (dt.getData('text/plain') || '') : '' } catch (err) {}
            if (!txt) { try { txt = dt ? (dt.getData('text/uri-list') || '') : '' } catch (err) {} }
            txt = (txt || '').trim().replace(/^file:\/\//i, '')
            if (txt) {
              const parts = txt.split(/[\\/]/).filter(Boolean)
              const base = parts.length ? parts[parts.length - 1] : ''
              if (base && base !== '.' && base !== '..') f = { name: base, size: null }
            }
          }
          if (f && f.name) {
            idleSinceMs = Date.now()
            eatFile(f)
            return true
          }
          let typesDesc = 'none'
          try { typesDesc = (dt && dt.types && dt.types.length) ? dt.types.join(',') : 'none' } catch (err) {}
          setBubble({ text: '🐛 没识别到文件（drop类型=' + typesDesc + '）', ts: Date.now() })
          return false
        }
        const attachDrop = (el) => {
          anchorRef.current = el
          if (!el || el.__dshPetDrop) return
          el.__dshPetDrop = true
          const enter = (e) => {
            if (e.preventDefault) e.preventDefault()
            idleSinceMs = Date.now()
            playAnim('大口吃零食')
            beep('feed')
            setBubble({ text: '把文件拖给我吃 🍽️', ts: Date.now() })
          }
          const leave = (e) => {
            if (e.preventDefault) e.preventDefault()
            playAnim(CAT.idle)
          }
          el.addEventListener('dragenter', enter)
          el.addEventListener('dragleave', leave)
        }
        React.useEffect(() => {
          const inPet = (t) => {
            const el = anchorRef.current
            return !!(el && t && (el === t || el.contains(t)))
          }
          const over = (e) => {
            if (inPet(e.target)) {
              if (e.preventDefault) e.preventDefault()
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
            }
          }
          const drop = (e) => {
            if (inPet(e.target)) {
              if (e.preventDefault) e.preventDefault()
              if (e.stopPropagation) e.stopPropagation()
              processDrop(e.dataTransfer)
            }
          }
          window.addEventListener('dragover', over, true)
          window.addEventListener('drop', drop, true)
          return () => {
            window.removeEventListener('dragover', over, true)
            window.removeEventListener('drop', drop, true)
          }
        }, [])

        const toggleMute = () => { mutedFlag = !mutedFlag; setMuted(mutedFlag); setMenu(null) }
        const toggleHide = () => { hiddenFlag = !hiddenFlag; setHidden(hiddenFlag); setMenu(null) }
        const resetPos = () => { commitPos(0, 0); setMenu(null) }
        const scaleBy = (d) => { const s = Math.max(0.3, Math.min(1.2, Math.round((scale + d) * 10) / 10)); if (s !== scale) setScale(s) }
        const sassBy = (d) => { const s = Math.max(0, Math.min(100, Math.round((sassFlag + d) / 10) * 10)); if (s !== sassFlag) { sassFlag = s; setSass(s) } }
        const focusToggle = () => {
          setMenu(null)
          if (focusFlag) {
            focusFlag = false
            focusEndsAt = null
            recordFocus()
            setFocusing(false)
            setFocusLeft(null)
          } else {
            playAnim(CAT.focus)
            say('focus-start')
            focusEndsAt = Date.now() + 25 * 60 * 1000
            focusStartMs = Date.now()
            focusFlag = true
            setFocusing(true)
            setFocusLeft(25 * 60)
          }
        }

        const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation() }
        const persistPet = () => {
          saveJson(STORE_KEY, { pos: posRef, scale: scale, muted: mutedFlag, hidden: hiddenFlag, affinity: affinityFlag, sass: sassFlag, name: nameFlag, waterOn: waterOnFlag, birthday: birthdayFlag, personality: personalityFlag })
        }
        const clearChat = () => { setChatHistory([]); saveJson('dsh.vpet.chat', []); setBubble({ text: '聊天记忆已清空 🧹', ts: Date.now() }) }
        const saveName = () => {
          const v = (nameDraft || '').trim().slice(0, 12)
          nameFlag = v
          setPetName(v)
          setNameDraft(v)
          persistPet()
          setBubble({ text: v ? ('记住啦，我叫「' + v + '」😼 以后喊我名字我会理你') : '名字清空啦（还是没名字的野猫）', ts: Date.now() })
        }
        const saveBirthday = () => {
          const v = (birthdayDraft || '').trim().slice(0, 5)
          birthdayFlag = v
          setBirthday(v)
          setBirthdayDraft(v)
          persistPet()
          setBubble({ text: v ? ('记住啦，我生日是 ' + v + ' 🎂 那天要给我准备小鱼干') : '生日清空啦', ts: Date.now() })
        }
        const toggleWater = () => {
          waterOnFlag = !waterOnFlag
          setWaterOn(waterOnFlag)
          persistPet()
          setBubble({ text: waterOnFlag ? '💧 喝水提醒已开启（我会盯着你喝水）' : '💧 喝水提醒已关闭（渴死你我可不管）', ts: Date.now() })
        }
        const shiftPersonality = (delta) => {
          const next = Math.max(0, Math.min(100, Math.round((personalityFlag + delta) * 10) / 10))
          if (next === personalityFlag) return
          personalityFlag = next
          setPersonality(personalityFlag)
        }
        const loadTrash = () => {
          fetchJson('/dsh-pet/api/trash').then((r) => {
            setTrashList((r && Array.isArray(r.items)) ? r.items : [])
          }).catch(() => setTrashList([]))
        }
        const restoreFile = (name) => {
          fetchJson('/dsh-pet/api/restore', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: name })
          }).then((r) => {
            if (r && r.ok) { setBubble({ text: '已恢复 ' + r.restored + ' ✅', ts: Date.now() }); loadTrash() }
            else setBubble({ text: '🐛 ' + (r && r.diag ? r.diag : '恢复失败'), ts: Date.now() })
          }).catch((e) => setBubble({ text: '❌ ' + (e && e.message ? e.message : String(e)), ts: Date.now() }))
        }
        const purgeFile = (name) => {
          const sure = (typeof window !== 'undefined' && window.confirm) ? window.confirm('确定要彻底删除这个文件吗？此操作不可恢复！') : false
          if (!sure) return
          fetchJson('/dsh-pet/api/purge', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: name })
          }).then((r) => {
            if (r && r.ok) { setBubble({ text: '💥 已彻底删除', ts: Date.now() }); loadTrash() }
            else setBubble({ text: '🐛 ' + (r && r.diag ? r.diag : '删除失败'), ts: Date.now() })
          }).catch((e) => setBubble({ text: '❌ ' + (e && e.message ? e.message : String(e)), ts: Date.now() }))
        }
        const loadMem = () => {
          fetchJson('/dsh-pet/api/memory').then((r) => {
            setMemList((r && Array.isArray(r.memories)) ? r.memories : [])
          }).catch(() => setMemList([]))
        }
        const deleteMem = (id) => {
          fetchJson('/dsh-pet/api/memory/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: id })
          }).then((r) => {
            if (r && r.ok) { setBubble({ text: '已删掉这条记忆 🧹', ts: Date.now() }); loadMem() }
            else setBubble({ text: '🐛 ' + (r && r.diag ? r.diag : '删除失败'), ts: Date.now() })
          }).catch((e) => setBubble({ text: '❌ ' + (e && e.message ? e.message : String(e)), ts: Date.now() }))
        }
        const addMem = () => {
          const content = (memDraft || '').trim()
          if (!content || memBusy) return
          setMemBusy(true)
          fetchJson('/dsh-pet/api/memory/add', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content: content, category: memCat, date: '' })
          }).then((r) => {
            setMemBusy(false)
            if (r && r.ok) { setMemDraft(''); setBubble({ text: '🧠 记下啦', ts: Date.now() }); loadMem() }
            else setBubble({ text: '🐛 ' + (r && r.diag ? r.diag : '添加失败'), ts: Date.now() })
          }).catch((e) => { setMemBusy(false); setBubble({ text: '❌ ' + (e && e.message ? e.message : String(e)), ts: Date.now() }) })
        }
        const downloadBlob = (filename, text) => {
          try {
            const blob = new Blob([text], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
          } catch (err) { setBubble({ text: '❌ 导出失败：' + (err && err.message ? err.message : String(err)), ts: Date.now() }) }
        }
        const LS_KEYS = ['dsh.vpet.v1', 'dsh.vpet.chat', 'dsh.vpet.ach.c', 'dsh.vpet.ach.u', 'dsh.vpet.day', 'dsh.vpet.diary', 'dsh.vpet.water', 'dsh.vpet.festive']
        const exportData = () => {
          const local = {}
          for (const k of LS_KEYS) {
            try {
              if (typeof window !== 'undefined' && window.localStorage) {
                const v = window.localStorage.getItem(k)
                if (v != null) local[k] = JSON.parse(v)
              }
            } catch (err) {}
          }
          fetchJson('/dsh-pet/api/memory').then((r) => {
            const blob = { exportedAt: new Date().toISOString(), local: local, memory: (r && Array.isArray(r.memories)) ? r.memories : [] }
            downloadBlob('dsh-pet-backup.json', JSON.stringify(blob, null, 2))
            setBubble({ text: '📦 数据已导出', ts: Date.now() })
          }).catch((e) => setBubble({ text: '❌ ' + (e && e.message ? e.message : String(e)), ts: Date.now() }))
        }
        const importData = (file) => {
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            try {
              const blob = JSON.parse(reader.result)
              if (blob && blob.local && typeof blob.local === 'object') {
                for (const k of Object.keys(blob.local)) { saveJson(k, blob.local[k]) }
              }
              const finish = () => setBubble({ text: '📦 导入完成，刷新页面后生效', ts: Date.now() })
              if (blob && Array.isArray(blob.memory)) {
                fetchJson('/dsh-pet/api/memory/import', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ memories: blob.memory })
                }).then((r) => { if (r && r.ok) setBubble({ text: '📦 导入完成（含 ' + (r.count || 0) + ' 条记忆），刷新页面后生效', ts: Date.now() }); else finish() }).catch(finish)
              } else finish()
            } catch (err) { setBubble({ text: '❌ 文件解析失败', ts: Date.now() }) }
          }
          reader.readAsText(file)
        }

        if (hidden) {
          return React.createElement('div', { className: 'dsh-vpet-restore', title: '显示桌宠', onClick: () => { hiddenFlag = false; setHidden(false) } }, '🐾')
        }

        const menuItem = (label, onClick) => React.createElement('div', { className: 'dsh-vpet-menu-item', onClick: onClick }, label)
        const menuEl = menu ? React.createElement('div', {
          className: 'dsh-vpet-menu',
          onPointerDown: (e) => { if (e.stopPropagation) e.stopPropagation() }
        },
          menuItem(focusing ? ('🍅 专注中 ' + fmtClock(focusLeft || 0) + ' · 结束') : '🍅 开始专注 25min', focusToggle),
          menuItem('💬 聊天', () => { setChatOpen(!chatOpen); setMenu(null) }),
          menuItem('📊 状态', () => { setStatusOpen(!statusOpen); setMenu(null) }),
          menuItem('📔 日记本', () => { setDiaryOpen(!diaryOpen); setMenu(null) }),
          menuItem('🧠 记忆本', () => { setMemOpen(!memOpen); setMenu(null); loadMem() }),
          menuItem('🍩 投喂', () => { playAnim('大口吃零食'); spawnParticles(['🍬', '🍩', '💖'], 12, ['#ff8fab', '#ffb3c6', '#c3f0ca']); setMoodTmp('happy', 30000); bumpAch('feed', 1); bumpDay('feed', 1); touchNight(); shiftPersonality(0.5); say('feed'); beep('feed') }),
          menuItem('🙈 隐藏桌宠', toggleHide),
          React.createElement('div', { className: 'dsh-vpet-menu-sep' }),
          menuItem('📍 复位位置', resetPos),
          menuItem('⚙️ 设置', () => { setSettingsOpen(true); setMenu(null); loadTrash() })
        ) : null

        const url = '/dsh-pet/video/' + encodeURIComponent(anim) + '.webm'

        const attachVideo = (el) => {
          if (!el) return
          el.muted = true
          el.defaultMuted = true
          try {
            const p = el.play()
            if (p && typeof p.catch === 'function') p.catch(() => {})
          } catch (err) {}
        }
        const onLoadedMetadata = (e) => {
          const d = e.currentTarget && e.currentTarget.duration
          if (typeof d === 'number' && d > 0 && d < 60) {
            curDurMs = Math.round(d * 1000)
            if (movePlan) movePlan.durMs = curDurMs
          }
        }
        const onError = () => setFailed(true)

        // 桌宠贴近屏幕顶部时，气泡改到身体下方弹出，避免冒出视口导致「对话框不显示」。
        const bubbleFlipDown = (() => {
          if (!bubble) return false
          const petTop = vh - 8 - VH + pos.y
          return petTop < 200
        })()

        const anchorEl = React.createElement('div', {
          className: 'dsh-vpet-anchor' + (dragging ? ' dsh-vpet-dragging' : ''),
          style: { transform: 'translate(' + pos.x + 'px,' + pos.y + 'px)' },
          title: '桌宠 · 拖/点/摸/长按/投喂文件，右键菜单',
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: onPointerUp,
          onPointerCancel: onPointerUp,
          onContextMenu: onContextMenu,
          ref: attachDrop
        },
          menuEl,
          focusing ? React.createElement('div', { className: 'dsh-vpet-focusbadge' }, '🍅 ' + fmtClock(focusLeft || 0)) : null,
          bubble ? React.createElement('div', { className: 'dsh-vpet-bubble' + (bubbleFlipDown ? ' dsh-vpet-bubble-down' : '') }, bubbleText) : null,
          particles.map((p) => p.dot
            ? React.createElement('span', {
                key: p.id,
                className: 'dsh-vpet-particle dsh-vpet-particle-dot',
                style: { left: p.x + '%', animationDelay: p.delay + 'ms', width: p.size + 'px', height: p.size + 'px', background: p.dot, boxShadow: '0 0 8px ' + p.dot }
              })
            : React.createElement('span', {
                key: p.id,
                className: 'dsh-vpet-particle dsh-vpet-particle-emoji',
                style: { left: p.x + '%', animationDelay: p.delay + 'ms', fontSize: p.size + 'px' }
              }, p.emoji)),
          failed
            ? React.createElement('div', { className: 'dsh-vpet-fallback', style: { width: VW + 'px', height: VH + 'px' } }, '🐱')
            : React.createElement('video', {
                key: animKey,
                className: 'dsh-vpet-video',
                src: url,
                ref: attachVideo,
                autoPlay: true,
                loop: sleeping || anim === CAT.drag,
                muted: true,
                playsInline: true,
                style: { transform: 'scaleX(' + facing + ') rotate(var(--dsh-tilt, 0deg))', width: VW + 'px', height: VH + 'px' },
                onEnded: onEnded,
                onLoadedMetadata: onLoadedMetadata,
                onError: onError,
                draggable: false
              })
        )

        const startPanelDrag = (e, setPos) => {
          if (!e || (typeof e.button === 'number' && e.button !== 0)) return
          const head = e.currentTarget
          const panel = head && head.parentElement
          if (!head || !panel) return
          const rect = panel.getBoundingClientRect()
          const startX = e.clientX
          const startY = e.clientY
          const origX = rect.left
          const origY = rect.top
          const move = (ev) => {
            const nx = origX + (ev.clientX - startX)
            const ny = origY + (ev.clientY - startY)
            const w = (typeof window !== 'undefined' && typeof window.innerWidth === 'number') ? window.innerWidth : 1200
            const h = (typeof window !== 'undefined' && typeof window.innerHeight === 'number') ? window.innerHeight : 800
            setPos({ x: Math.max(-320, Math.min(nx, w - 60)), y: Math.max(0, Math.min(ny, h - 60)) })
          }
          const up = () => {
            head.removeEventListener('pointermove', move)
            head.removeEventListener('pointerup', up)
            head.removeEventListener('pointercancel', up)
            try { if (head.releasePointerCapture && typeof e.pointerId === 'number') head.releasePointerCapture(e.pointerId) } catch (err) {}
          }
          head.addEventListener('pointermove', move)
          head.addEventListener('pointerup', up)
          head.addEventListener('pointercancel', up)
          try { if (head.setPointerCapture && typeof e.pointerId === 'number') head.setPointerCapture(e.pointerId) } catch (err) {}
          if (e.preventDefault) e.preventDefault()
        }
        const resetPanel = (setPos) => () => setPos(null)

        const toggleSec = (id) => setSecOpen((prev) => Object.assign({}, prev, { [id]: !prev[id] }))
        const section = (id, icon, label, kids) => {
          const open = !!secOpen[id]
          return React.createElement(React.Fragment, { key: id },
            React.createElement('div', { className: 'dsh-vpet-sec-head', onClick: () => toggleSec(id) },
              React.createElement('span', { className: 'dsh-vpet-sec-arrow' }, open ? '▾' : '▸'),
              React.createElement('span', { className: 'dsh-vpet-sec-label' }, icon + ' ' + label)
            ),
            open ? React.createElement('div', { className: 'dsh-vpet-sec-body' }, kids) : null
          )
        }

        const settingsEl = settingsOpen ? React.createElement('div', {
          className: 'dsh-vpet-settings',
          style: settingsPos ? { left: settingsPos.x + 'px', top: settingsPos.y + 'px', transform: 'none' } : undefined,
          onPointerDown: stop,
          onPointerUp: stop,
          onMouseDown: stop,
          onClick: stop
        },
          React.createElement('div', { className: 'dsh-vpet-settings-head', onPointerDown: (e) => startPanelDrag(e, setSettingsPos), onDoubleClick: resetPanel(setSettingsPos) },
            React.createElement('span', { className: 'dsh-vpet-settings-title' },
              React.createElement('span', { className: 'dsh-vpet-settings-grip' }, '⠿'),
              '⚙️ 桌宠设置'
            ),
            React.createElement('span', { className: 'dsh-vpet-settings-close', onPointerDown: stop, onClick: () => { setSettingsOpen(false); setSettingsPos(null) } }, '✕')
          ),
          section('base', '🔧', '基础', [
            React.createElement('div', { className: 'dsh-vpet-settings-row' },
              React.createElement('span', { className: 'dsh-vpet-settings-label' }, '✏️ 名字'),
              React.createElement('div', { className: 'dsh-vpet-name-row' },
                React.createElement('input', { className: 'dsh-vpet-name-input', value: nameDraft, placeholder: '给它起个名字…', maxLength: 12, onChange: (e) => setNameDraft(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') saveName() } }),
                React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: saveName }, '保存')
              )
            ),
            React.createElement('div', { className: 'dsh-vpet-settings-row' },
              React.createElement('span', { className: 'dsh-vpet-settings-label' }, '🎂 生日 (MM-DD)'),
              React.createElement('div', { className: 'dsh-vpet-name-row' },
                React.createElement('input', { className: 'dsh-vpet-name-input', value: birthdayDraft, placeholder: '如 08-20', maxLength: 5, onChange: (e) => setBirthdayDraft(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') saveBirthday() } }),
                React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: saveBirthday }, '保存')
              )
            ),
            React.createElement('div', { className: 'dsh-vpet-settings-row' },
              React.createElement('span', { className: 'dsh-vpet-settings-label' }, '🔍 大小 ' + Math.round(scale * 100) + '%'),
              React.createElement('input', { type: 'range', min: 30, max: 120, step: 5, value: Math.round(scale * 100), onChange: (e) => { const v = Number(e.target.value) || 50; setScale(v / 100) } })
            )
          ]),
          section('persona', '🎭', '性格与提醒', [
            React.createElement('div', { className: 'dsh-vpet-settings-row' },
              React.createElement('span', { className: 'dsh-vpet-settings-label' }, '😤 毒舌程度 ' + sassFlag),
              React.createElement('input', { type: 'range', min: 0, max: 100, value: sassFlag, onChange: (e) => { const v = Number(e.target.value) || 0; sassFlag = v; setSass(v) } })
            ),
            React.createElement('div', { className: 'dsh-vpet-settings-row' },
              React.createElement('span', { className: 'dsh-vpet-settings-label' }, '💧 喝水提醒'),
              React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: toggleWater }, waterOn ? '已开启 · 点关闭' : '已关闭 · 点开启')
            ),
            React.createElement('div', { className: 'dsh-vpet-settings-row' },
              React.createElement('span', { className: 'dsh-vpet-settings-label' }, '🔇 吐槽'),
              React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: toggleMute }, muted ? '已静音 · 点开启' : '开启中 · 点静音')
            )
          ]),
          section('grow', '🏆', '养成', [
            React.createElement('div', { className: 'dsh-vpet-settings-row' },
              React.createElement('span', { className: 'dsh-vpet-settings-label' }, '💖 好感度 ' + affinityFlag),
              React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: () => { affinityFlag = 50; setAffinity(50); setBubble({ text: '好感度重置为 50 💔', ts: Date.now() }) } }, '重置')
            ),
            React.createElement('div', { className: 'dsh-vpet-settings-label' }, '🏅 成就 ' + Object.keys(achUnlocked).length + '/' + ACHIEVEMENTS.length),
            React.createElement('div', { className: 'dsh-vpet-ach-grid' },
              ACHIEVEMENTS.map((a) => {
                const done = achDone(a.id)
                const val = achVal(a.key)
                return React.createElement('div', { key: a.id, className: 'dsh-vpet-ach-item ' + (done ? 'dsh-vpet-ach-on' : 'dsh-vpet-ach-off'), title: a.desc },
                  React.createElement('span', { className: 'dsh-vpet-ach-icon' }, done ? a.icon : '🔒'),
                  React.createElement('span', { className: 'dsh-vpet-ach-name' }, a.name),
                  React.createElement('span', { className: 'dsh-vpet-ach-prog' }, done ? '✓' : (val + '/' + a.need))
                )
              })
            ),
            React.createElement('div', { className: 'dsh-vpet-settings-row' },
              React.createElement('span', { className: 'dsh-vpet-settings-label' }, '📔 心情日记 (' + (Array.isArray(diaryList) ? diaryList.length : 0) + ' 篇)'),
              React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: () => { setSettingsOpen(false); setDiaryOpen(true) } }, '打开')
            )
          ]),
          section('data', '🧹', '数据', [
            React.createElement('div', { className: 'dsh-vpet-settings-row' },
              React.createElement('span', { className: 'dsh-vpet-settings-label' }, '🧠 聊天记忆'),
              React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: clearChat }, '清空')
            ),
            React.createElement('div', { className: 'dsh-vpet-settings-row' },
              React.createElement('span', { className: 'dsh-vpet-settings-label' }, '📦 数据备份'),
              React.createElement('span', { className: 'dsh-vpet-trash-actions' },
                React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: exportData }, '导出'),
                React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: () => fileInputRef.current && fileInputRef.current.click() }, '导入'),
                React.createElement('input', { ref: fileInputRef, type: 'file', accept: 'application/json', style: { display: 'none' }, onChange: (e) => { importData(e.target.files && e.target.files[0]); e.target.value = '' } })
              )
            ),
            React.createElement('div', { className: 'dsh-vpet-settings-label' }, '🗑️ 被吃掉的文件（可恢复）'),
            trashList === null
              ? React.createElement('div', { className: 'dsh-vpet-settings-hint' }, '加载中…')
              : (trashList.length === 0
                  ? React.createElement('div', { className: 'dsh-vpet-settings-hint' }, '（空）还没吃过文件')
                  : React.createElement('div', { className: 'dsh-vpet-trash' },
                      trashList.map((t) => React.createElement('div', { key: t.name, className: 'dsh-vpet-trash-item' },
                        React.createElement('span', { className: 'dsh-vpet-trash-name', title: t.original }, t.original),
                        React.createElement('span', { className: 'dsh-vpet-trash-actions' },
                          React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: () => restoreFile(t.name) }, '恢复'),
                          React.createElement('button', { className: 'dsh-vpet-settings-btn dsh-vpet-btn-danger', onClick: () => purgeFile(t.name) }, '彻底删除')
                        )
                      ))
                    ))
          ])
        ) : null

        const achToastEl = achToast ? React.createElement('div', { className: 'dsh-vpet-achtoast' },
          React.createElement('span', { className: 'dsh-vpet-achtoast-icon' }, achToast.icon),
          React.createElement('span', null, '成就解锁 · ' + achToast.name)
        ) : null

        const curMood = currentMood()
        const moodInfo = curMood === 'happy' ? ['😊', '开心'] : curMood === 'angry' ? ['😠', '生气'] : curMood === 'sleepy' ? ['😴', '困'] : ['😼', '傲娇']
        const personalityLabel = personality >= 70 ? '撒娇黏人' : personality >= 35 ? '标准傲娇' : '高冷傲娇'
        const ds = dayStats || {}
        const achDoneCount = Object.keys(achUnlocked).length
        const statusBar = (icon, label, num, text, color) => React.createElement('div', { className: 'dsh-vpet-status-row' },
          React.createElement('span', { className: 'dsh-vpet-status-k' }, icon + ' ' + label),
          React.createElement('div', { className: 'dsh-vpet-status-track' },
            React.createElement('div', { className: 'dsh-vpet-status-fill', style: { width: Math.max(0, Math.min(100, Number(num) || 0)) + '%', background: color || 'var(--dsw-alias-brand-primary,#4a90d9)' } })
          ),
          React.createElement('span', { className: 'dsh-vpet-status-v' }, text)
        )

        const statusEl = statusOpen ? React.createElement('div', {
          className: 'dsh-vpet-status',
          style: statusPos ? { left: statusPos.x + 'px', top: statusPos.y + 'px', right: 'auto' } : undefined,
          onPointerDown: stop,
          onPointerUp: stop,
          onMouseDown: stop,
          onClick: stop
        },
          React.createElement('div', { className: 'dsh-vpet-status-head', onPointerDown: (e) => startPanelDrag(e, setStatusPos), onDoubleClick: resetPanel(setStatusPos) },
            React.createElement('span', null, '📊 ' + (nameFlag ? nameFlag + ' 的状态' : '桌宠状态')),
            React.createElement('span', { className: 'dsh-vpet-settings-close', onPointerDown: stop, onClick: () => { setStatusOpen(false); setStatusPos(null) } }, '✕')
          ),
          React.createElement('div', { className: 'dsh-vpet-status-row' },
            React.createElement('span', { className: 'dsh-vpet-status-k' }, moodInfo[0] + ' 情绪'),
            React.createElement('span', { className: 'dsh-vpet-status-v' }, moodInfo[1])
          ),
          statusBar('💖', '好感度', affinity, affinity + ' / 100', '#ff6b9d'),
          statusBar('😼', '性格', personality, personalityLabel + ' ' + personality, '#b197fc'),
          statusBar('🗡️', '毒舌', sass, sass + ' / 100', '#ffa94d'),
          React.createElement('div', { className: 'dsh-vpet-status-sep' }),
          React.createElement('div', { className: 'dsh-vpet-status-k' }, '📅 今日互动'),
          React.createElement('div', { className: 'dsh-vpet-status-grid' },
            React.createElement('span', null, '💬 ' + (ds.chat || 0)),
            React.createElement('span', null, '🍩 ' + (ds.feed || 0)),
            React.createElement('span', null, '🖐️ ' + (ds.pet || 0)),
            React.createElement('span', null, '🗑️ ' + (ds.eat || 0)),
            React.createElement('span', null, '💢 ' + (ds.poke || 0))
          ),
          React.createElement('div', { className: 'dsh-vpet-status-k' }, '🏅 成就 ' + achDoneCount + ' / ' + ACHIEVEMENTS.length),
          React.createElement('div', { className: 'dsh-vpet-status-sep' }),
          React.createElement('div', { className: 'dsh-vpet-status-k' }, '💼 今日工作'),
          React.createElement('div', { className: 'dsh-vpet-status-grid' },
            React.createElement('span', null, '⏱️ ' + (ds.focusMin || 0) + '分'),
            React.createElement('span', null, '✅ ' + (ds.taskDone || 0)),
            React.createElement('span', null, '❌ ' + (ds.taskFailed || 0)),
            React.createElement('span', null, '🔌 ' + (ds.ssh || 0) + '次')
          ),
          React.createElement('button', { className: 'dsh-vpet-settings-btn', style: { width: '100%', marginTop: '8px' }, onClick: generateReview }, '📋 生成今日复盘')
        ) : null

        const chatEl = chatOpen ? React.createElement('div', {
          className: 'dsh-vpet-chat',
          style: chatPos ? { left: chatPos.x + 'px', top: chatPos.y + 'px' } : undefined,
          onPointerDown: stop,
          onPointerUp: stop,
          onMouseDown: stop,
          onClick: stop
        },
          React.createElement('div', { className: 'dsh-vpet-chat-head', onPointerDown: (e) => startPanelDrag(e, setChatPos), onDoubleClick: resetPanel(setChatPos) },
            React.createElement('span', null, '💬 跟桌宠聊天'),
            React.createElement('span', { className: 'dsh-vpet-chat-close', onPointerDown: stop, onClick: () => { setChatOpen(false); setChatPos(null) } }, '✕')
          ),
          React.createElement('div', { className: 'dsh-vpet-chat-log', ref: chatLogRef },
            (Array.isArray(chatHistory) ? chatHistory : []).map((m, i) => React.createElement('div', {
              key: i,
              className: 'dsh-vpet-chat-msg ' + (m && m.role === 'assistant' ? 'dsh-vpet-chat-a' : 'dsh-vpet-chat-u')
            }, m && m.text ? m.text : ''))
          ),
          React.createElement('div', { className: 'dsh-vpet-chat-row' },
            React.createElement('input', {
              className: 'dsh-vpet-chat-input',
              value: chatText,
              placeholder: chatBusy ? '它在想…' : '说点什么…',
              onChange: (e) => setChatText(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') sendChat() }
            }),
            React.createElement('button', { className: 'dsh-vpet-chat-btn', onClick: sendChat, disabled: chatBusy }, '发送')
          )
        ) : null

        const fmtDiaryDate = (s) => {
          const p = (s || '').split('-')
          if (p.length !== 3) return s || ''
          const y = Number(p[0]); const m = Number(p[1]); const d = Number(p[2])
          const dt = new Date(y, m - 1, d)
          const wk = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()] || '日'
          return y + '年' + m + '月' + d + '日 · 周' + wk
        }

        const diaryEl = diaryOpen ? React.createElement('div', {
          className: 'dsh-vpet-diarypanel',
          style: diaryPos ? { left: diaryPos.x + 'px', top: diaryPos.y + 'px', transform: 'none' } : undefined,
          onPointerDown: stop,
          onPointerUp: stop,
          onMouseDown: stop,
          onClick: stop
        },
          React.createElement('div', { className: 'dsh-vpet-diarypanel-head', onPointerDown: (e) => startPanelDrag(e, setDiaryPos), onDoubleClick: resetPanel(setDiaryPos) },
            React.createElement('span', { className: 'dsh-vpet-settings-title' },
              React.createElement('span', { className: 'dsh-vpet-settings-grip' }, '⠿'),
              '📔 心情日记'
            ),
            React.createElement('span', { className: 'dsh-vpet-settings-close', onPointerDown: stop, onClick: () => { setDiaryOpen(false); setDiaryPos(null) } }, '✕')
          ),
          React.createElement('div', { className: 'dsh-vpet-diarypanel-toolbar' },
            React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: () => { rollDay(); writeDiary(dayStats.date, dayStats) }, disabled: diaryBusy }, diaryBusy ? '✍️ 写着…' : '✍️ 写今天的日记')
          ),
          React.createElement('div', { className: 'dsh-vpet-diarypanel-list' },
            (Array.isArray(diaryList) && diaryList.length
              ? diaryList.map((d) => React.createElement('div', { key: d.date, className: 'dsh-vpet-diarycard' },
                  React.createElement('div', { className: 'dsh-vpet-diarycard-date' }, '📅 ' + fmtDiaryDate(d.date)),
                  React.createElement('div', { className: 'dsh-vpet-diarycard-text' }, d.text)
                ))
              : React.createElement('div', { className: 'dsh-vpet-diarypanel-empty' }, '还没有日记\n点上面的按钮，写下今天的第一篇吧 ✨'))
          )
        ) : null

        const MEM_CATS = { goal: '🎯 目标', deadline: '⏰ 时间点', preference: '💗 喜好', event: '📌 事件' }
        const memEl = memOpen ? React.createElement('div', {
          className: 'dsh-vpet-mempanel',
          style: memPos ? { left: memPos.x + 'px', top: memPos.y + 'px', transform: 'none' } : undefined,
          onPointerDown: stop,
          onPointerUp: stop,
          onMouseDown: stop,
          onClick: stop
        },
          React.createElement('div', { className: 'dsh-vpet-mempanel-head', onPointerDown: (e) => startPanelDrag(e, setMemPos), onDoubleClick: resetPanel(setMemPos) },
            React.createElement('span', { className: 'dsh-vpet-settings-title' },
              React.createElement('span', { className: 'dsh-vpet-settings-grip' }, '⠿'),
              '🧠 记忆本'
            ),
            React.createElement('span', { className: 'dsh-vpet-settings-close', onPointerDown: stop, onClick: () => { setMemOpen(false); setMemPos(null) } }, '✕')
          ),
          React.createElement('div', { className: 'dsh-vpet-mem-add' },
            React.createElement('select', { className: 'dsh-vpet-mem-select', value: memCat, onChange: (e) => setMemCat(e.target.value) },
              Object.keys(MEM_CATS).map((k) => React.createElement('option', { key: k, value: k }, MEM_CATS[k]))
            ),
            React.createElement('input', { className: 'dsh-vpet-name-input', value: memDraft, placeholder: '手动加一条…', maxLength: 120, onChange: (e) => setMemDraft(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') addMem() } }),
            React.createElement('button', { className: 'dsh-vpet-settings-btn', onClick: addMem, disabled: memBusy }, memBusy ? '…' : '加')
          ),
          React.createElement('div', { className: 'dsh-vpet-mem-list' },
            (Array.isArray(memList) && memList.length
              ? memList.map((m) => React.createElement('div', { key: m.id, className: 'dsh-vpet-mem-item' },
                  React.createElement('div', { className: 'dsh-vpet-mem-top' },
                    React.createElement('span', { className: 'dsh-vpet-mem-cat' }, (MEM_CATS[m.category] || '📌 事件') + (m.date ? ' · ' + m.date : '')),
                    React.createElement('button', { className: 'dsh-vpet-mem-del', title: '删除这条', onClick: () => deleteMem(m.id) }, '✕')
                  ),
                  React.createElement('div', { className: 'dsh-vpet-mem-content' }, m.content)
                ))
              : React.createElement('div', { className: 'dsh-vpet-mem-empty' }, '还没有记忆\n聊几句天我会自动记住你的事\n也可以手动加一条'))
          )
        ) : null

        return React.createElement(React.Fragment, null, anchorEl, achToastEl, settingsEl, statusEl, chatEl, diaryEl, memEl)
      }

      ctx.effect(() => {
        const el = document.createElement('style')
        el.textContent = CSS
        document.head.appendChild(el)
        return () => { if (el.parentNode) el.parentNode.removeChild(el) }
      }, 'dsh-pet: styles')

      ctx.effect(() => {
        return slots.inject('shell.overlay', () => slots.register(
          { name: 'shell.overlay', id: 'desktop-pet', label: '桌宠' },
          () => React.createElement(VideoPet)
        ))
      }, 'dsh-pet: overlay')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
