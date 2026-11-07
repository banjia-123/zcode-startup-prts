// prts-boot 启动动画运行时（P2 完整五幕）。
// 幕①黑幕开机 → 幕②PRTS 字标 → 幕③身份档案（等确认）→ 幕④验证进度 → 幕⑤ACCESS GRANTED 揭幕。
// 全部时长按 speed 倍率换算；异常兜底：任何环节挂了都强制 finish，不许困在黑幕。
(() => {
  'use strict'

  // M2 握手揭幕：handshake 模式（coverBoot 冷启动）下，final 屏等 ZCode 就绪信号再揭幕
  const HANDSHAKE = (() => {
    try {
      return new URLSearchParams(location.search).get('handshake') === '1'
    } catch {
      return false
    }
  })()
  let zcodeReady = false
  // 揭幕门控：握手模式等 ZCode 就绪；无论模式都等人声念完——两者齐才揭幕
  const revealGate = { zcode: !HANDSHAKE, tts: false, fired: false }
  function checkReveal() {
    if (revealGate.fired) return
    if (revealGate.zcode && revealGate.tts) {
      revealGate.fired = true
      reveal()
    }
  }
  try {
    window.prts.onZcodeReady(() => {
      zcodeReady = true
      revealGate.zcode = true
      checkReveal()
    })
  } catch {}

  const $ = (id) => document.getElementById(id)
  const root = $('prts-root')
  const black = $('prts-black')
  const boot = document.querySelector('.prts-boot')
  const wash = $('prts-wash')
  const brand = $('prts-brand')
  const corners = document.querySelectorAll('.prts-corner')
  const account = $('prts-account')
  const btn = $('prts-btn')
  const skipEl = $('prts-skip')
  const statusEl = $('prts-status')
  const hexEl = $('prts-hex')
  const final = $('prts-final')
  const stage = $('prts-stage')
  const pctL = $('prts-pct-l')
  const pctR = $('prts-pct-r')
  const fillL = $('prts-fill-l')
  const fillR = $('prts-fill-r')
  const headL = $('prts-head-l')
  const headR = $('prts-head-r')
  const lineMid = $('prts-line-mid')
  const flash = $('prts-flash')

  let speed = 1
  const ms = (base) => Math.max(16, base / speed)

  /* ---------- 状态 ---------- */
  let config = {
    enabled: true,
    identity: 'Doctor',
    identityId: '0001',
    accessLevel: '8',
    theme: 'light',
    speed: 1,
    requireInteraction: true,
    allowSkip: true,
    sfx: true,
  }
  let grantedStarted = false
  let leaving = false
  let hexTimer = null
  let idleTimer = null

  /* ---------- 合成音效（WebAudio，无素材依赖） ---------- */
  function makeAudio(enabled) {
    if (!enabled) return { rise() {}, blip() {}, glitch() {}, click() {}, step() {}, chime() {} }
    let ctx = null
    function ac() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return null
        ctx = new AC()
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      return ctx
    }
    function tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.1, gain = 0.04, when = 0 }) {
      const c = ac()
      if (!c) return
      const t = c.currentTime + when
      const osc = c.createOscillator()
      const g = c.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(f0, t)
      if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + dur)
      g.gain.setValueAtTime(gain, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(g).connect(c.destination)
      osc.start(t)
      osc.stop(t + dur + 0.02)
    }
    // 低频上滑开机音
    function rise() {
      tone({ type: 'sine', f0: 55, f1: 220, dur: 1.2, gain: 0.06 })
    }
    // 轻确认音
    function blip() {
      tone({ type: 'square', f0: 1320, dur: 0.06, gain: 0.03 })
    }
    // 入侵 glitch 音：白噪声爆 + 方波降调
    function glitch() {
      const c = ac()
      if (!c) return
      const t = c.currentTime
      const dur = 0.25
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
      }
      const src = c.createBufferSource()
      src.buffer = buf
      const g1 = c.createGain()
      g1.gain.value = 0.05
      src.connect(g1).connect(c.destination)
      src.start(t)
      tone({ type: 'square', f0: 880, f1: 110, dur: 0.2, gain: 0.04 })
    }
    // 确认点击：双频方波
    function click() {
      tone({ type: 'square', f0: 1320, dur: 0.06, gain: 0.025 })
      tone({ type: 'square', f0: 1980, dur: 0.06, gain: 0.02, when: 0.02 })
    }
    // 验证步进 tick
    function step() {
      tone({ type: 'square', f0: 660, dur: 0.04, gain: 0.025 })
    }
    // 完成琶音
    function chime() {
      tone({ type: 'sine', f0: 523.25, dur: 0.5, gain: 0.05 })
      tone({ type: 'sine', f0: 659.25, dur: 0.5, gain: 0.05, when: 0.09 })
      tone({ type: 'sine', f0: 783.99, dur: 0.6, gain: 0.05, when: 0.18 })
    }
    // 入侵前兆杂音：短促带通噪声爆点（音量小、渐强，配合画面抖动/色差）
    function staticBurst(intensity, dur = 0.12, freq = 1800) {
      const c = ac()
      if (!c) return
      const t = c.currentTime
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
      const src = c.createBufferSource()
      src.buffer = buf
      const bp = c.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = freq
      bp.Q.value = 0.8
      const g = c.createGain()
      g.gain.value = intensity
      src.connect(bp).connect(g).connect(c.destination)
      src.start(t)
    }
    // 故障盖音：采样保持（bitcrush 感）噪声，全强度起、末段急收（干脆地盖住整词）
    function glitchCover(intensity = 0.1, dur = 0.45) {
      const c = ac()
      if (!c) return
      const t = c.currentTime
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
      const d = buf.getChannelData(0)
      const hold = Math.floor(c.sampleRate / 2000) // 2kHz 采样保持
      let held = 0
      const tail = Math.floor(d.length * 0.72) // 前 72% 全强度，末 28% 急收
      for (let i = 0; i < d.length; i++) {
        if (i % hold === 0) held = Math.random() * 2 - 1
        const env = i < tail ? 1 : 1 - (i - tail) / (d.length - tail)
        d[i] = (held * 0.7 + (Math.random() * 2 - 1) * 0.3) * env
      }
      const src = c.createBufferSource()
      src.buffer = buf
      const bp = c.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1400
      bp.Q.value = 0.5
      const g = c.createGain()
      g.gain.value = intensity
      src.connect(bp).connect(g).connect(c.destination)
      src.start(t)
      staticBurst(0.06, 0.2, 300) // 低频隆隆垫底
    }
    return { rise, blip, glitch, click, step, chime, staticBurst, glitchCover }
  }
  let audio = { rise() {}, blip() {}, glitch() {}, click() {}, step() {}, chime() {}, staticBurst() {}, glitchCover() {} }

  /* ---------- 访客身份遮罩（幕⑤）：故障音起时人名文字变故障色块 ---------- */
  let maskTimer = null
  function maskWelcomeName() {
    const el = $('prts-welcome-name')
    if (!el || el.classList.contains('prts-masked')) return
    el.classList.add('prts-masked')
    const POOL = '01<>/\\|#@$%&{}[]=+*ΞΨЖДｱｲｳｴｵ0123456789ABCDEF'
    const rand = (n) => Math.floor(Math.random() * n)
    maskTimer = setInterval(() => {
      let s = ''
      const len = 5 + rand(3)
      for (let i = 0; i < len; i++) s += POOL[rand(POOL.length)]
      el.textContent = s
    }, 90)
  }

  /* ---------- 乱码撕裂层：入侵式（转场/揭幕用） ---------- */
  function makeTear() {
    const tear = $('prts-tear')
    if (!tear) return { on() {}, off() {} }
    const POOL =
      '01<>/\\|#@$%&{}[]=+*─│┌┐└┘├┤0123456789ABCDEFΞΨЖДΩｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ'
    const SIG = 'Welcome back, Doctor.'
    const rand = (n) => Math.floor(Math.random() * n)
    const slices = []
    const bars = []
    for (let i = 0; i < 8; i++) {
      const d = document.createElement('div')
      d.className = 'prts-slice'
      d.style.animationDuration = 70 + rand(90) + 'ms'
      d.style.animationDelay = rand(60) + 'ms'
      d.style.opacity = (0.4 + Math.random() * 0.5).toFixed(2)
      tear.appendChild(d)
      slices.push(d)
    }
    const sig = document.createElement('div')
    sig.className = 'prts-slice prts-sig'
    sig.style.animationDuration = 100 + rand(60) + 'ms'
    tear.appendChild(sig)
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('div')
      b.className = 'prts-bar'
      tear.appendChild(b)
      bars.push(b)
    }
    function refString() {
      let s = ''
      for (let i = 0; i < 240; i++) s += POOL[rand(POOL.length)]
      return s
    }
    function refStringShort() {
      let s = ''
      for (let i = 0; i < 44; i++) s += POOL[rand(POOL.length)]
      return s
    }
    function layout() {
      slices.forEach((el) => {
        el.style.top = rand(96) + '%'
        el.style.height = (1 + rand(5)) + 'em'
        el.textContent = refString()
      })
      // 签名句固定屏幕中央：多数时间清晰浮现，偶尔被乱码吞掉
      if (Math.random() < 0.3) {
        sig.textContent = refStringShort()
      } else {
        sig.textContent = SIG
      }
      bars.forEach((el) => {
        el.style.top = rand(96) + '%'
        el.style.height = (2 + rand(20)) + 'px'
      })
    }
    let timer = null
    function on() {
      layout()
      tear.classList.add('prts-on')
      root.classList.add('prts-shake')
      audio.glitch()
      root.classList.add('prts-invert')
      setTimeout(() => root.classList.remove('prts-invert'), 60)
      setTimeout(() => {
        root.classList.add('prts-invert')
        setTimeout(() => root.classList.remove('prts-invert'), 50)
      }, 210)
      timer = setInterval(layout, 80)
    }
    function off() {
      if (timer) clearInterval(timer)
      timer = null
      tear.classList.remove('prts-on')
      root.classList.remove('prts-shake')
      root.classList.remove('prts-invert')
    }
    return { on, off }
  }
  const tear = makeTear()

  /* ---------- 金色测地线框球（Canvas，参考同款） ---------- */
  function makeSphere(canvas) {
    if (!canvas || !canvas.getContext) return { start() {}, stop() {}, fast() {} }
    const ctx = canvas.getContext('2d')
    let raf = 0
    let running = false
    let speed = 0.0045
    let rotY = 0.6
    const rotX0 = 0.42
    let W = 0
    let H = 0

    // 测地球：icosahedron 细分一次 → 42 顶点 120 边
    const norm = (v) => {
      const l = Math.hypot(v[0], v[1], v[2])
      return [v[0] / l, v[1] / l, v[2] / l]
    }
    const t = (1 + Math.sqrt(5)) / 2
    const verts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map(norm)
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ]
    const midCache = new Map()
    function midpoint(a, b) {
      const key = a < b ? a + '_' + b : b + '_' + a
      if (midCache.has(key)) return midCache.get(key)
      const A = verts[a]
      const B = verts[b]
      verts.push(norm([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2]))
      const idx = verts.length - 1
      midCache.set(key, idx)
      return idx
    }
    const faces2 = []
    faces.forEach(([a, b, c]) => {
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      faces2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    })
    const edgeSet = new Set()
    const edges = []
    faces2.forEach(([a, b, c]) => {
      ;[[a, b], [b, c], [c, a]].forEach(([p, q]) => {
        const key = p < q ? p + '_' + q : q + '_' + p
        if (!edgeSet.has(key)) {
          edgeSet.add(key)
          edges.push([p, q])
        }
      })
    })

    // 背景星点
    const stars = Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1.1,
      tw: Math.random() * Math.PI * 2,
    }))

    function resize() {
      const dpr = window.devicePixelRatio || 1
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function frame(now) {
      if (!running) return
      rotY += speed
      const rotX = rotX0 + Math.sin(now * 0.00018) * 0.12
      ctx.clearRect(0, 0, W, H)
      const cx = W / 2
      const cy = H * 0.46
      const R = Math.min(W, H) * 0.3

      for (const s of stars) {
        const a = 0.12 + 0.45 * (0.5 + 0.5 * Math.sin(now * 0.001 + s.tw))
        ctx.fillStyle = `rgba(240,240,236,${a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2)
        ctx.fill()
      }

      const cosY = Math.cos(rotY)
      const sinY = Math.sin(rotY)
      const cosX = Math.cos(rotX)
      const sinX = Math.sin(rotX)
      const P = verts.map(([x, y, z]) => {
        const x1 = x * cosY + z * sinY
        const z1 = -x * sinY + z * cosY
        const y2 = y * cosX - z1 * sinX
        const z2 = y * sinX + z1 * cosX
        const persp = 2.6 / (2.6 - z2)
        return [cx + x1 * R * persp, cy - y2 * R * persp, z2]
      })
      ctx.lineWidth = 1
      for (const [a, b] of edges) {
        const depth = (P[a][2] + P[b][2]) / 2
        const alpha = 0.16 + 0.62 * (depth + 1) / 2
        ctx.strokeStyle = `rgba(255, 204, 77, ${alpha.toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(P[a][0], P[a][1])
        ctx.lineTo(P[b][0], P[b][1])
        ctx.stroke()
      }
      raf = requestAnimationFrame(frame)
    }

    window.addEventListener('resize', resize)
    function start() {
      if (running) return
      running = true
      resize()
      raf = requestAnimationFrame(frame)
    }
    function stop() {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    function fast() {
      speed = 0.014
    }
    return { start, stop, fast }
  }
  let sphereCtl = null
  function startSphere() {
    if (!sphereCtl) sphereCtl = makeSphere($('prts-sphere'))
    sphereCtl.start()
  }
  function stopSphere() {
    if (sphereCtl) sphereCtl.stop()
  }
  function sphereFast() {
    if (sphereCtl) sphereCtl.fast()
  }

  /* ---------- 时钟 ---------- */
  function startClock() {
    const el = $('prts-clock')
    if (!el) return
    const pad = (n) => String(n).padStart(2, '0')
    const tick = () => {
      const d = new Date()
      el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    }
    tick()
    setInterval(tick, 250)
  }

  /* ---------- hex 滚动（验证期间） ---------- */
  function startHex() {
    if (hexTimer) return
    hexEl.classList.add('prts-on')
    const hex4 = () => Math.floor(Math.random() * 65536).toString(16).toUpperCase().padStart(4, '0')
    const line = () => `0x${hex4()} ${hex4()} ${hex4()} ${hex4()}`
    const tick = () => {
      hexEl.textContent = `${line()}\n${line()}`
    }
    tick()
    hexTimer = setInterval(tick, 95)
  }
  function stopHex() {
    if (hexTimer) clearInterval(hexTimer)
    hexTimer = null
    hexEl.classList.remove('prts-on')
  }

  /* ---------- 收场 ---------- */
  let finished = false
  function finish() {
    if (finished) return
    finished = true
    try {
      window.prts.finish()
    } catch {
      // 桥不可用 → 90s watchdog 收窗
    }
  }

  function cleanupAll() {
    tear.off()
    stopHex()
    stopSphere()
    if (maskTimer) clearInterval(maskTimer)
    maskTimer = null
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel() // 中途跳过时停掉人声
    } catch {}
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    window.removeEventListener('keydown', onKey)
  }

  function outro() {
    if (leaving) return
    leaving = true
    cleanupAll()
    root.classList.add('prts-out')
    setTimeout(finish, ms(640))
  }

  /* ---------- 键盘 ---------- */
  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      grant()
    } else if (e.key === 'Escape') {
      if (config.allowSkip) skip()
    }
  }

  /* ---------- 幕④：验证序列 ---------- */
  function setStatus(text) {
    statusEl.textContent = text
  }
  function setProgress(pct) {
    const text = pct + '%'
    // 两侧线呈百分比效果：暗金轨道上亮金填充生长，头部光点与百分比数字同步跟随
    fillL.style.width = pct + '%'
    fillR.style.width = pct + '%'
    headL.style.left = pct + '%'
    headR.style.right = pct + '%'
    pctL.style.left = `calc(${pct}% + 10px)`
    pctR.style.right = `calc(${pct}% + 10px)`
    pctL.textContent = text
    pctR.textContent = text
    // 100%：两侧线贯通合拢（中央连线从中心向两侧展开）
    if (pct >= 100) lineMid.classList.add('prts-on')
  }

  function grant() {
    if (grantedStarted || leaving) return
    grantedStarted = true
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    skipEl.classList.remove('prts-show')
    account.classList.add('prts-confirmed')
    brand.classList.add('prts-out-brand') // 字标屏让位
    stage.classList.add('prts-in') // 黑舞台接管
    startSphere()
    audio.click()
    startHex()
    statusEl.classList.add('prts-on')

    setStatus('正在验证身份…')
    setProgress(6)
    setTimeout(() => { setStatus('同步罗德岛数据库…'); setProgress(30); audio.step() }, ms(700))
    setTimeout(() => { setStatus('读取权限档案…'); setProgress(56); audio.step() }, ms(1650))
    setTimeout(() => { setStatus('校验终端签名…'); setProgress(78); audio.step() }, ms(2600))
    setTimeout(() => { setStatus('访问许可已授予'); setProgress(100); audio.step() }, ms(3550))
    setTimeout(() => {
      stopHex()
      statusEl.classList.remove('prts-on')
      sphereFast() // 球体加速旋转
      final.classList.add('prts-in')
      audio.chime()
      // TTS 即刻起播（与琶音并行）；念完 + （握手）ZCode 就绪 → 才揭幕
      const ttsSettle = () => {
        if (revealGate.tts) return
        revealGate.tts = true
        checkReveal()
      }
      speakTTS(ttsSettle)
      setTimeout(ttsSettle, ms(4200)) // TTS 兜底：超时未结束也放行
      // 握手模式：提前查询就绪状态（防止错过早到的就绪信号）
      if (HANDSHAKE) {
        try {
          window.prts
            .isZcodeReady()
            .then((v) => {
              if (v) {
                zcodeReady = true
                revealGate.zcode = true
                checkReveal()
              }
            })
            .catch(() => {})
        } catch {}
      }
    }, ms(3950))
  }

  /* ---------- 幕⑤人声：系统 TTS 合成女声（无录音噪声/伪影） ---------- */
  const TTS_FEMALE = /zira|aria|jenny|ana\b|emma|michelle|samantha|karen|moira|tessa|sonia|libby|xiaoxiao|yaoyao|huihui|female/i
  const TTS_MALE = /david|mark|george|guy|ryan|james|male|yunyang|yunxi|yunjian|kangkang/i
  function pickVoice(voices, langPrefix) {
    const pool = voices.filter((v) => new RegExp('^' + langPrefix, 'i').test(v.lang))
    if (!pool.length) return null
    return pool.find((v) => TTS_FEMALE.test(v.name)) || pool.find((v) => !TTS_MALE.test(v.name)) || pool[0]
  }
  function speakTTS(onDone) {
    if (!config.sfx) {
      if (onDone) setTimeout(onDone, 0)
      return
    }
    try {
      const synth = window.speechSynthesis
      if (!synth) {
        if (onDone) setTimeout(onDone, 0)
        return
      }
      const ascii = /^[\x00-\x7F]*$/.test(String(config.identity))
      let settled = false
      const settle = () => {
        if (!settled) {
          settled = true
          if (onDone) onDone()
        }
      }
      const preferred = pickVoice(synth.getVoices(), ascii ? 'en' : 'zh')
      function speak(text, pitch, rate, vol, onend, onstart) {
        const u = new SpeechSynthesisUtterance(text)
        u.lang = ascii ? 'en-US' : 'zh-CN'
        u.pitch = pitch
        u.rate = rate
        u.volume = vol
        if (preferred) u.voice = preferred
        u.onend = onend
        u.onerror = onend
        if (onstart) u.onstart = onstart
        synth.speak(u)
      }
      if (ascii) {
        // 拆段法：TTS 只念 'Welcome back'（清晰），故障音替代 'Doctor'——隐藏访客身份。
        // 连接要紧：onstart 后按语速预估时长提前 ~120ms 触发（轻微咬住尾音），onend 兜底补触发
        let covered = false
        const cover = () => {
          if (covered) return
          covered = true
          audio.glitchCover(0.16, 0.7)
          maskWelcomeName() // 画面同步：人名被故障色块吞掉
          setTimeout(settle, 400) // 故障音进行中完成揭幕切换
        }
        speak(
          'Welcome back',
          1.45,
          0.95,
          0.9,
          cover, // onend 兜底
          () => setTimeout(cover, 900), // 提前触发：'Welcome back' @0.95 约 1.0s
        )
      } else {
        speak(`欢迎回来，${config.identity}`, 0.92, 0.88, 0.9, settle)
      }
      setTimeout(settle, 2800) // 兜底：合成器无响应也放行
    } catch {
      if (onDone) setTimeout(onDone, 0)
    }
  }

  // ---------- PRTS 机房氛围垫音（合成，幕②接管起持续到揭幕） ----------
  // 独立 AudioContext：不依赖人声解码完成，幕②准时响起
  let ambientCtx = null
  let ambientNodes = null
  function startAmbient() {
    if (!config.sfx || ambientNodes) return
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      if (!ambientCtx) ambientCtx = new AC()
      const c = ambientCtx
      if (c.state === 'suspended') c.resume().catch(() => {})
      const out = c.createGain()
      out.gain.value = 0
      out.connect(c.destination)
      // 低频双振荡：机房嗡鸣
      const o1 = c.createOscillator()
      o1.type = 'sine'
      o1.frequency.value = 55
      const o2 = c.createOscillator()
      o2.type = 'sine'
      o2.frequency.value = 110.3 // 轻微失谐产生缓慢拍频
      const og = c.createGain()
      og.gain.value = 0.35
      o1.connect(og)
      o2.connect(og)
      og.connect(out)
      // 带通白噪声：空气底
      const nb = c.createBuffer(1, 2 * c.sampleRate, c.sampleRate)
      const nd = nb.getChannelData(0)
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
      const ns = c.createBufferSource()
      ns.buffer = nb
      ns.loop = true
      const bp = c.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 220
      bp.Q.value = 0.6
      const ng = c.createGain()
      ng.gain.value = 0.5
      ns.connect(bp).connect(ng).connect(out)
      // LFO 缓慢起伏
      const lfo = c.createOscillator()
      lfo.frequency.value = 0.15
      const lg = c.createGain()
      lg.gain.value = 0.02
      lfo.connect(lg).connect(out.gain)
      out.gain.setValueAtTime(0, c.currentTime)
      out.gain.linearRampToValueAtTime(0.09, c.currentTime + 0.8) // 0.8s 淡入
      o1.start()
      o2.start()
      ns.start()
      lfo.start()
      ambientNodes = { out, o1, o2, ns, lfo }
    } catch {}
  }
  function stopAmbient() {
    if (!ambientNodes || !ambientCtx) return
    try {
      const c = ambientCtx
      const t = c.currentTime
      ambientNodes.out.gain.cancelScheduledValues(t)
      ambientNodes.out.gain.setValueAtTime(ambientNodes.out.gain.value, t)
      ambientNodes.out.gain.linearRampToValueAtTime(0, t + 0.5) // 0.5s 淡出
      const nodes = ambientNodes
      ambientNodes = null
      setTimeout(() => {
        try {
          nodes.o1.stop()
          nodes.o2.stop()
          nodes.ns.stop()
          nodes.lfo.stop()
        } catch {}
      }, 600)
    } catch {}
  }

  /* ---------- 揭幕门控：等 TTS 念完 +（握手）ZCode 就绪 ---------- */

  /* ---------- 幕⑤：揭幕（无闪白/撕裂，直接机位后撤） ---------- */
  function reveal() {
    try {
      stopAmbient() // 揭幕时氛围垫音淡出
      setTimeout(() => {
        root.classList.add('prts-handoff')
        setTimeout(finish, ms(760))
      }, ms(400))
    } catch {
      finish() // 揭幕失败也要走
    }
  }

  /* ---------- 跳过 ---------- */
  function skip() {
    if (grantedStarted || leaving) return
    audio.blip()
    outro()
  }

  /* ---------- 幕③：等待确认 ---------- */
  function waitForAction() {
    btn.addEventListener('click', grant)
    account.addEventListener('click', (e) => {
      if (e.target === skipEl || skipEl.contains(e.target)) return
      grant()
    })
    skipEl.addEventListener('click', skip)
    window.addEventListener('keydown', onKey)

    if (!config.requireInteraction) {
      setTimeout(grant, ms(2400))
    } else {
      // 55s 无操作自动放行：赶在 main 进程 90s watchdog 之前，避免窗口被硬杀
      idleTimer = setTimeout(grant, ms(55_000))
    }
  }

  /* ---------- 主序列 ---------- */
  function run() {
    // 幕①：ZCode 用户登录 → 验证途中被 PRTS 入侵
    setTimeout(() => {
      boot.classList.add('prts-in')
      audio.rise()
    }, ms(280))
    setTimeout(() => boot.classList.add('prts-label'), ms(1180))
    setTimeout(() => boot.classList.add('prts-login-in'), ms(1400)) // 登录信息逐行浮现
    setTimeout(() => $('prts-boot-status').classList.add('prts-on'), ms(2000))
    // 入侵前兆：画面渐趋不稳定（验证开始 → 临近洗白逐步加剧），电流杂音同步渐强
    setTimeout(() => {
      black.classList.add('prts-uneasy')
      audio.staticBurst(0.02)
    }, ms(2300))
    setTimeout(() => {
      black.classList.add('prts-uneasy2')
      audio.staticBurst(0.04)
    }, ms(3100))
    setTimeout(() => audio.staticBurst(0.06), ms(3500))

    // 入侵事件：过曝洗白 → 乱码撕裂（ZCode 登录被 PRTS 打断，界面转属 PRTS）
    setTimeout(() => {
      wash.classList.remove('prts-decay')
      wash.style.setProperty('opacity', '1')
    }, ms(2900))
    setTimeout(() => {
      black.classList.add('prts-hide')
    }, ms(3080))
    setTimeout(() => {
      wash.classList.add('prts-decay')
      wash.style.setProperty('opacity', '0')
      tear.on()
    }, ms(3760))

    // 幕②：PRTS 字标（撕裂 1s 收尾瞬间入场）——PRTS 接管，机房氛围从这里起
    setTimeout(() => {
      tear.off()
      brand.classList.add('prts-in')
      corners.forEach((c) => c.classList.add('prts-on'))
      audio.blip()
      startAmbient()
    }, ms(4760))

    // 幕③：PRTS 登录屏（入侵后的身份档案确认）
    setTimeout(() => {
      account.classList.add('prts-in')
      if (config.allowSkip) skipEl.classList.add('prts-show')
      waitForAction()
    }, ms(5380))

    // 终极兜底：60s 强制收场（赶在 main 90s watchdog 之前）
    setTimeout(finish, ms(60_000))
  }

  /* ---------- 启动 ---------- */
  ;(async () => {
    try {
      const cfg = await window.prts.getConfig()
      if (cfg && typeof cfg === 'object') config = { ...config, ...cfg }
    } catch {
      // 拿不到配置 → 默认值照播
    }
    const s = Number(config.speed)
    speed = Number.isFinite(s) ? Math.min(3, Math.max(0.35, s)) : 1
    audio = makeAudio(!!config.sfx)

    // 配置注入
    $('prts-identity').textContent = String(config.identity || '博士')
    $('prts-identity-id').textContent = String(config.identityId || '0001')
    // 卡片大字固定 #0（与参考图一致）；档案卡编号保持配置原样
    $('prts-card-id').textContent = '#0'
    // 幕① ZCode 登录信息（同源配置）
    $('prts-boot-identity').textContent = String(config.identity || 'Doctor')
    $('prts-boot-id').textContent = String(config.identityId || '0001')
    $('prts-boot-access').textContent = String(config.accessLevel || '8')
    $('prts-access').textContent = String(config.accessLevel || '8')
    // 欢迎语：英文身份用 Welcome back，中文身份用「欢迎回来」
    const identityText = String(config.identity || 'Doctor')
    const isAscii = /^[\x00-\x7F]*$/.test(identityText)
    $('prts-welcome-prefix').textContent = isAscii ? 'Welcome back, ' : '欢迎回来，'
    $('prts-welcome-name').textContent = identityText
    if (config.theme === 'light') root.classList.add('prts-light')

    startClock()
    // 等窗口真正可见再起播（防止幕①在 show 之前被吞）；3s 兜底防 IPC 丢失
    let started = false
    const startOnce = () => {
      if (started) return
      started = true
      run()
    }
    try {
      window.prts.onWindowShown(startOnce)
    } catch {}
    setTimeout(startOnce, 3000)
  })().catch(() => {
    // 配置都拿不到也要播下去
    run()
  })
})()
