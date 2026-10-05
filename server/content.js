export const MODEL = 'gpt-6.1-sol';

export const DEFAULT_SETTINGS = {
  genre: 'arcade', visualStyle: 'neon', aspectRatio: '16:9',
  difficulty: 'normal', sound: true, language: 'en',
};

export const TEMPLATES = [
  {
    "id": "neon-runner",
    "name": "Neon Courier",
    "title": "Neon Courier",
    "genre": "runner",
    "theme": "#c9ff5b",
    "description": "A readable, fast-paced rooftop runner built around a courier, energy cells, and a city that speeds up.",
    "prompt": "Build a complete, playable side-scrolling rooftop runner. The courier runs automatically; Space, Arrow Up, or a large touch button jumps, with one mid-air jump. Spawn obstacles only with safe, reachable gaps; introduce taller obstacles after a short onboarding stretch. Collect energy cells for 10 bonus points and award distance points continuously. Increase speed gradually with a capped maximum. A collision ends the run. Include start, pause/resume, score, instructions, game-over, and restart states. Keep the courier, hazards, and collectibles visually distinct at mobile sizes. No external dependencies or network requests.",
    "tags": [
      "Double jump",
      "Procedural obstacles",
      "Score challenge"
    ],
    "estimatedMinutes": 8,
    "steps": [
      "Tune the jump and obstacle spacing",
      "Bind courier and skyline references",
      "Generate, playtest, and balance speed"
    ],
    "materials": {
      "character": {
        "title": "Rooftop courier",
        "content": "A compact, agile delivery runner. Keep a pale jacket and lime visor visible against the city, with a clear airborne pose.",
        "specifications": {
          "appearance": "Small side-view silhouette, pale utility jacket, lime visor, two-frame running stride.",
          "personality": "Focused courier; squash slightly on landing and lean forward while accelerating.",
          "abilities": "Automatic horizontal motion; ground jump plus one air jump; landing resets both jumps."
        }
      },
      "scene": {
        "title": "Night delivery route",
        "content": "A layered city route with a readable roofline and unobtrusive parallax buildings.",
        "specifications": {
          "environment": "Muted charcoal skyline with sparse window lights; foreground hazards remain highest contrast.",
          "layout": "Continuous floor; stagger short and tall barriers with enough recovery distance; avoid impossible consecutive jumps.",
          "camera": "Fixed side view; player stays near the left third, with three parallax background layers."
        }
      },
      "prop": {
        "title": "Energy cell",
        "content": "A luminous cell that rewards a deliberate jump without obscuring the obstacle below.",
        "specifications": {
          "usage": "Small lime capsule collectible; violet barrier blocks are hazards and must look different.",
          "interaction": "Collect by overlap, then disappear with a short pulse and a +10 label.",
          "rules": "One collection per cell; never spawn inside a barrier; score includes distance and cell bonuses."
        }
      },
      "audio": {
        "title": "Courier soundscape",
        "content": "Light rhythmic percussion and concise cues that help the player time the run.",
        "specifications": {
          "mood": "Restrained electronic pulse; avoid a loud or relentless soundtrack.",
          "trigger": "Soft jump tick, bright two-note pickup, low collision cue, and short game-over cadence.",
          "mixing": "Start sound only after user interaction; background at 0.2, effects at 0.5; provide mute; pause suspends audio."
        }
      }
    },
    "output": {
      "title": "Neon Courier game",
      "content": "Acceptance: double jump resets only on landing; hazards are reachable; a cell scores once; restart resets speed and score; desktop and touch controls both work."
    },
    "settings": {
      "genre": "runner",
      "visualStyle": "neon",
      "language": "en"
    },
    "locales": {
      "zh": {
        "name": "霓虹信使",
        "description": "以屋顶信使、能量电池和逐渐加速的城市为核心，制作节奏清晰的横版跑酷。",
        "prompt": "制作完整可玩的横版屋顶跑酷。信使自动奔跑；空格、上方向键或大触屏按钮跳跃，允许一次空中二段跳。障碍必须保持可通过的间距，教学段后再引入高障碍。拾取能量电池加10分，距离持续计分。速度逐渐增加并设置上限，碰撞结束本局。包含开始、暂停继续、分数、操作说明、失败和重开状态。移动端人物、危险和收集物应清晰可辨，不依赖外部网络。",
        "materials": {
          "character": {
            "title": "屋顶信使",
            "content": "紧凑敏捷的送货角色，浅色夹克和青柠护目镜应在城市背景中保持清晰。",
            "specifications": {
              "appearance": "侧视小比例轮廓、浅色工具夹克、青柠护目镜，两帧奔跑动作。",
              "personality": "专注送货，落地略微压缩，加速时身体前倾。",
              "abilities": "自动横向奔跑；地面跳跃加一次空中跳跃；落地恢复跳跃次数。"
            }
          },
          "scene": {
            "title": "夜间送货路线",
            "content": "城市分层视差保持克制，让屋顶、危险和跳跃间距清晰可读。",
            "specifications": {
              "environment": "暗灰天际线与稀疏窗灯，前景障碍保持最高对比。",
              "layout": "连续地面，高低障碍交错，保留恢复距离，不生成无法通过的连续跳跃。",
              "camera": "固定侧视，角色保持左侧三分之一，背景采用三层视差。"
            }
          },
          "prop": {
            "title": "能量电池",
            "content": "用明亮电池奖励有意图的跳跃，不遮挡下方障碍。",
            "specifications": {
              "usage": "小型青柠胶囊收集物；紫色方块为障碍，视觉明显区分。",
              "interaction": "重叠拾取后消失，播放短脉冲并显示+10。",
              "rules": "每颗只计分一次，不与障碍重叠；总分包含距离与拾取奖励。"
            }
          },
          "audio": {
            "title": "信使声音",
            "content": "轻节奏配乐与简短提示，辅助判断奔跑节奏。",
            "specifications": {
              "mood": "克制电子节奏，避免嘈杂或持续高强度配乐。",
              "trigger": "轻跳跃声、两音拾取提示、低沉碰撞声和短结束音。",
              "mixing": "用户操作后才启动声音；背景0.2、音效0.5，可静音；暂停同步挂起音频。"
            }
          }
        },
        "output": {
          "title": "霓虹信使游戏",
          "content": "验收：二段跳只在落地恢复；障碍可通过；电池只计分一次；重开恢复速度和分数；键盘与触屏均可操作。"
        },
        "steps": [
          "确定跳跃和障碍间距",
          "绑定信使与天际线参考图",
          "生成试玩并平衡速度"
        ]
      }
    },
    "legacyPrompts": [
      "制作一个完整可玩的霓虹横版跑酷游戏。主角自动奔跑，空格或点击跳跃，可二段跳。随机生成障碍与可收集能量球，速度逐渐增加。具有开始界面、实时分数、暂停、死亡后重新开始。使用深色赛博城市背景、荧光绿与紫色粒子，提供触屏按钮。"
    ]
  },
  {
    "id": "space-defender",
    "name": "Orbit Guard",
    "title": "Orbit Guard",
    "genre": "shooter",
    "theme": "#8ca8ff",
    "description": "An approachable top-down shooter with an interceptor, enemy waves, and a clear survival loop.",
    "prompt": "Build a complete top-down space shooter. Move with WASD/arrow keys or touch drag, with an auto-firing player ship that stays inside the arena. Enemy scouts enter from above in gradually denser waves; defeat them for points and dodge their bodies and drifting asteroids. Start with three lives and grant brief visible invulnerability after a hit to prevent repeated loss in one contact. Use a controlled blue/white player palette and warm enemy highlights. Include start, pause, score, lives, game over, restart, and clear controls. Keep the gameplay readable on desktop and mobile; implement real collisions and deterministic cleanup of offscreen objects.",
    "tags": [
      "Auto fire",
      "Enemy waves",
      "Touch movement"
    ],
    "estimatedMinutes": 10,
    "steps": [
      "Set ship movement and damage rules",
      "Review enemy silhouettes and arena",
      "Generate and test a complete survival run"
    ],
    "materials": {
      "character": {
        "title": "Aster interceptor",
        "content": "A small interceptor with a sharp triangular silhouette and readable thrusters.",
        "specifications": {
          "appearance": "Blue-white triangular hull, bright central cockpit, small engine trail; clearly distinct from red scouts.",
          "personality": "Responsive escort pilot; bank gently left/right without changing the hitbox.",
          "abilities": "Free movement inside arena; automatic forward shots; three lives; brief flashing invulnerability after hits."
        }
      },
      "scene": {
        "title": "Orbital approach",
        "content": "A low-noise starfield leaves space for targets, projectiles, and the player HUD.",
        "specifications": {
          "environment": "Deep navy space with sparse small stars and a faint planet arc outside the play area.",
          "layout": "Enemies enter from top; player starts near bottom center; keep UI outside the collision arena.",
          "camera": "Fixed top-down camera; subtle downward star drift communicates forward travel."
        }
      },
      "prop": {
        "title": "Scouts and asteroids",
        "content": "Two clearly distinct threats create aiming and dodging decisions.",
        "specifications": {
          "usage": "Warm red scout ships can be destroyed; grey asteroids are solid hazards with chunkier silhouettes.",
          "interaction": "Player shots remove scouts and award points; contacts damage player once per invulnerability window.",
          "rules": "Cap active enemies; spawn away from player start; remove expired projectiles; difficulty rises at readable intervals."
        }
      },
      "audio": {
        "title": "Orbital radio and effects",
        "content": "Short, dry cues communicate firing, hits, and danger without masking the game.",
        "specifications": {
          "mood": "Light space ambience and a steady, subdued electronic pulse.",
          "trigger": "Quiet automatic shot cue, brighter enemy hit, distinct player damage alert, short defeat cue.",
          "mixing": "Rate-limit rapid firing sounds; user gesture unlocks audio; pause and mute affect all voices."
        }
      }
    },
    "output": {
      "title": "Orbit Guard game",
      "content": "Acceptance: movement clamps to arena; shots and enemies are cleaned up; hit invulnerability works; restarting clears every projectile; keyboard and drag inputs are responsive."
    },
    "settings": {
      "genre": "shooter",
      "visualStyle": "neon",
      "language": "en"
    },
    "locales": {
      "zh": {
        "name": "星际守卫",
        "description": "通过拦截机、敌人波次和清晰生存循环，制作容易上手的俯视射击游戏。",
        "prompt": "制作完整的俯视太空射击。WASD、方向键或触屏拖动移动，飞船自动开火并限制在竞技场内。敌方侦察机从上方进入，波次逐渐密集，击败得分，躲避飞船与漂移陨石。初始三条生命，受击后显示短暂无敌，避免一次接触连续扣命。主角蓝白色，敌方暖色。包含开始、暂停、分数、生命、失败、重开和操作说明。桌面与移动端保持清晰，使用真实碰撞并清理离屏对象。",
        "materials": {
          "character": {
            "title": "星芒拦截机",
            "content": "三角轮廓的小型拦截机，推进器和座舱清晰可辨。",
            "specifications": {
              "appearance": "蓝白三角机身，亮色中央座舱，小型引擎尾迹，与红色敌机明显区分。",
              "personality": "操控灵敏，左右移动时轻微倾斜但不改变碰撞范围。",
              "abilities": "场内自由移动，自动向前射击，三条生命，受击后闪烁并短暂无敌。"
            }
          },
          "scene": {
            "title": "轨道航线",
            "content": "低干扰星空，为目标、子弹和状态栏留出空间。",
            "specifications": {
              "environment": "深蓝太空，稀疏小星点，星球弧线置于主要玩法区之外。",
              "layout": "敌机从上方进入，玩家从底部中央出发，界面不占碰撞区域。",
              "camera": "固定俯视镜头，星点缓慢下移表达前进感。"
            }
          },
          "prop": {
            "title": "侦察机与陨石",
            "content": "两类可区分威胁产生瞄准和闪避选择。",
            "specifications": {
              "usage": "暖红侦察机可击毁，灰色陨石为较大轮廓的实体危险。",
              "interaction": "子弹移除敌机并计分，接触在一次无敌窗口内只扣一次生命。",
              "rules": "限制同时存在敌人数量，出生点避开玩家，清理过期子弹，按可读节奏提升难度。"
            }
          },
          "audio": {
            "title": "轨道无线电与音效",
            "content": "短而干净的提示传达开火、命中和危险。",
            "specifications": {
              "mood": "轻太空氛围与低音量稳定电子节奏。",
              "trigger": "轻自动开火声、亮敌机命中声、可区分的受击警报和短失败音。",
              "mixing": "连续开火音效限频；交互后解锁音频；暂停和静音控制所有声音。"
            }
          }
        },
        "output": {
          "title": "星际守卫游戏",
          "content": "验收：移动限制在场内；子弹与敌人正常清理；受击无敌生效；重开清空子弹；键盘和拖动操作灵敏。"
        },
        "steps": [
          "设定飞船移动与伤害规则",
          "检查敌方轮廓和竞技场",
          "生成并测试完整生存过程"
        ]
      }
    },
    "legacyPrompts": [
      "制作一个完整可玩的俯视角太空射击游戏。WASD/方向键或触屏拖动移动飞船，空格射击。敌人分波次出现，有陨石、生命值、分数与简单升级。背景为星空，视觉使用蓝紫色霓虹。必须有开始、暂停、胜利或失败、重新开始界面。"
    ]
  },
  {
    "id": "forest-jump",
    "name": "Mosslight Trail",
    "title": "Mosslight Trail",
    "genre": "platformer",
    "theme": "#83d7a0",
    "description": "A short handcrafted forest platformer with readable jumps, stars, and a rewarding exit.",
    "prompt": "Build a complete short 2D platform adventure. Move with A/D or arrows, jump with Space or a touch button. Create a handcrafted level with reachable low, medium, and high platforms, five collectible stars, a small number of marked hazards, and a clearly visible finish gate. Use stable gravity and top-surface landing collisions; allow a small coyote-time window and buffered jump for forgiving controls. The player wins by reaching the gate after collecting at least three stars, and fails on falling or touching a hazard. Include start, pause, star count, instructions, win, loss, and restart. Keep the forest backdrop subtle and make platform tops and hazards readable.",
    "tags": [
      "Reachable platforms",
      "Collectibles",
      "Level finish"
    ],
    "estimatedMinutes": 12,
    "steps": [
      "Measure jump range and platform gaps",
      "Build the star route and gate conditions",
      "Generate and playtest every reachable path"
    ],
    "materials": {
      "character": {
        "title": "Fern the trail guide",
        "content": "A small forest explorer whose feet and jump apex stay easy to track.",
        "specifications": {
          "appearance": "Warm cream tunic, moss-green scarf, dark boots; compact round silhouette with clear foot contact.",
          "personality": "Curious and deliberate; looks toward motion, with a short grounded landing bounce.",
          "abilities": "Horizontal walking, single jump, brief coyote time, buffered jump; no double jump in this workflow."
        }
      },
      "scene": {
        "title": "Mosslight clearing",
        "content": "A handcrafted forest clearing with an intentional route from the left spawn to a lit gate.",
        "specifications": {
          "environment": "Layered muted foliage, warm shafts of light, dark distant trees; platform tops use bright moss edges.",
          "layout": "Five stars on optional detours; three required; no platform gap exceeds the measured jump range.",
          "camera": "Side camera follows horizontal movement, clamped at level bounds; slight look-ahead toward movement."
        }
      },
      "prop": {
        "title": "Trail stars and finish gate",
        "content": "Stars guide the route while the finish gate communicates the actual goal.",
        "specifications": {
          "usage": "Small golden five-point stars, wooden exit arch with a soft lantern; red thorn patches are danger.",
          "interaction": "Stars disappear on pickup; gate stays closed until three are collected and then visibly lights up.",
          "rules": "Five stars total; every star counts once; gate requires overlap after unlocking; hazard triggers one loss state."
        }
      },
      "audio": {
        "title": "Woodland sound direction",
        "content": "Soft ambience supports gentle exploration with clear event feedback.",
        "specifications": {
          "mood": "Quiet woodland air and sparse marimba notes; avoid realistic animal calls that sound like alerts.",
          "trigger": "Foot landing tick, light star chime, distinct gate-unlock phrase, gentle win cadence, low fail tone.",
          "mixing": "User-triggered audio start; no repeated pickup cue; pause suspends ambience; mute accessible at all times."
        }
      }
    },
    "output": {
      "title": "Mosslight Trail game",
      "content": "Acceptance: all platforms are reachable; collision lands on top surfaces; exactly five unique stars; gate needs three; restart resets stars and gate; touch controls support simultaneous movement and jump."
    },
    "settings": {
      "genre": "platformer",
      "visualStyle": "illustration",
      "language": "en"
    },
    "locales": {
      "zh": {
        "name": "苔光小径",
        "description": "通过清晰跳跃、星星和可抵达出口，制作精心设计的森林平台小关卡。",
        "prompt": "制作完整的小型二维平台冒险。A/D或方向键移动，空格或触屏按钮跳跃。手工设计可抵达的低、中、高平台、五颗星星、少量明确危险与可见终点门。重力稳定并支持平台顶面落地碰撞，加入短土狼时间和跳跃缓冲。收集至少三颗星后抵达门获胜，跌落或触碰危险失败。包含开始、暂停、星星数量、说明、胜负与重开。森林背景保持克制，平台顶面和危险清晰。",
        "materials": {
          "character": {
            "title": "蕨叶向导",
            "content": "森林小探险家，脚部接触与跳跃顶点容易追踪。",
            "specifications": {
              "appearance": "暖米色短衣、苔绿色围巾、深色靴子，圆润紧凑轮廓与清晰脚部。",
              "personality": "好奇而稳重，朝移动方向看，落地有轻微回弹。",
              "abilities": "水平移动、一次跳跃、短土狼时间、跳跃缓冲，本工作流不使用二段跳。"
            }
          },
          "scene": {
            "title": "苔光空地",
            "content": "从左侧出生点到亮起终点门的手工森林路线。",
            "specifications": {
              "environment": "低饱和层叠叶片、暖光束、远处暗树，平台顶面采用亮苔边缘。",
              "layout": "五颗星位于可选岔路，三颗即可通关，平台间距不超过实测跳跃范围。",
              "camera": "横向跟随镜头限制在关卡边界，向移动方向轻微前视。"
            }
          },
          "prop": {
            "title": "路标星星与终点门",
            "content": "星星引导路线，终点门表达真正目标。",
            "specifications": {
              "usage": "金色五角小星、带柔光灯的木门，红色荆棘为危险。",
              "interaction": "星星拾取后消失，门在收集三颗后点亮解锁。",
              "rules": "共五颗星，每颗只计一次，解锁后重叠门通关，危险只触发一次失败状态。"
            }
          },
          "audio": {
            "title": "林地声音",
            "content": "柔和氛围支持轻探索，事件反馈保持清晰。",
            "specifications": {
              "mood": "安静林风与稀疏马林巴音，避免把动物叫声做成警报。",
              "trigger": "落地轻响、星星铃声、独立门解锁旋律、柔和胜利段和低失败音。",
              "mixing": "操作后启动，拾取声不重复触发，暂停停止氛围，可随时静音。"
            }
          }
        },
        "output": {
          "title": "苔光小径游戏",
          "content": "验收：所有平台可抵达；正确落在顶面；五颗独立星星；门需三颗星；重开重置收集和门；触屏支持同时移动与跳跃。"
        },
        "steps": [
          "测量跳跃范围与平台间距",
          "设计星星路线和门解锁条件",
          "生成并试玩所有可抵达路径"
        ]
      }
    },
    "legacyPrompts": [
      "制作一个完整可玩的二维平台跳跃游戏。角色用方向键/A D移动，空格跳跃。设计可达的多层平台、可收集星星、避开的危险与终点。使用清新森林、柔和插画风格。具有正确的碰撞和重力，开始、暂停、通关、掉落失败、重新开始以及触屏控制。"
    ]
  },
  {
    "id": "tile-puzzle",
    "name": "Color Memory",
    "title": "Color Memory",
    "genre": "puzzle",
    "theme": "#ffca91",
    "description": "A polished six-pair memory game with a welcoming guide, calm table, and precise reveal rules.",
    "prompt": "Build a complete memory matching puzzle with twelve cards arranged as a responsive 4-by-3 board (3-by-4 on narrow screens). Shuffle six pairs on each new game. Each card has both a color and a symbol so color is never the only cue. Reveal at most two unmatched cards; matching cards stay revealed, nonmatching cards turn back after 700ms, and input is locked during that delay. Count attempts, show matched pairs, and display a win message after all six pairs. Include a clear start/help state, pause that obscures unpaired cards, and restart that resets and reshuffles. Support mouse, touch, keyboard focus, and Enter/Space. No timing pressure or external assets are required.",
    "tags": [
      "Six pairs",
      "Accessible symbols",
      "Reveal timing"
    ],
    "estimatedMinutes": 7,
    "steps": [
      "Review symbols and reveal rules",
      "Tune the board for touch and keyboard",
      "Generate and test mismatch and restart timing"
    ],
    "materials": {
      "character": {
        "title": "Milo the puzzle guide",
        "content": "A friendly, unobtrusive guide offers short rules and celebrates completed matches.",
        "specifications": {
          "appearance": "Small warm-grey owl badge with amber scarf, simple linework; placed outside the card grid.",
          "personality": "Patient and encouraging; never reveals a card solution or interrupts active input.",
          "abilities": "Guide explains the two-card rule, reports remaining pairs, and celebrates completion without controlling gameplay."
        }
      },
      "scene": {
        "title": "Quiet puzzle table",
        "content": "A calm, high-contrast table frames the board and keeps focus on the cards.",
        "specifications": {
          "environment": "Charcoal tabletop with warm neutral panels and no animated background.",
          "layout": "Twelve evenly spaced cards; attempt count and progress above; restart and pause separate from card targets.",
          "camera": "Fixed top-down board; 4 by 3 desktop layout switches to 3 by 4 on mobile without clipping."
        }
      },
      "prop": {
        "title": "Six symbol card pairs",
        "content": "Readable symbols make pair identification work without relying only on colors.",
        "specifications": {
          "usage": "Circle, triangle, square, crescent, diamond, and cross; each symbol paired with a different warm/muted color.",
          "interaction": "Reveal one or two cards; matched pairs stay face up; mismatches turn back after a controlled delay.",
          "rules": "Exactly two cards per symbol; seeded shuffle per new game; ignore already matched cards and clicks during mismatch delay."
        }
      },
      "audio": {
        "title": "Match feedback",
        "content": "Small, pleasant sounds reinforce memory decisions without pressure.",
        "specifications": {
          "mood": "Optional quiet plucked tones; no urgent timer, ticking, or looping alert.",
          "trigger": "One flip tap, a two-note match chime, soft mismatch tone, and a short completed-board phrase.",
          "mixing": "Each accepted reveal sounds once; no overlapping long tones; all sounds user-unlocked and muteable."
        }
      }
    },
    "output": {
      "title": "Color Memory game",
      "content": "Acceptance: exactly six pairs; double-click cannot reveal a card twice; mismatch input is locked; restart cancels pending timers; completion fires once; keyboard navigation works."
    },
    "settings": {
      "genre": "puzzle",
      "visualStyle": "minimal",
      "language": "en"
    },
    "locales": {
      "zh": {
        "name": "色彩记忆",
        "description": "以亲切引导、安静桌面与精确翻牌规则，制作六组配对的记忆游戏。",
        "prompt": "制作完整的记忆配对益智游戏。十二张卡桌面4行列适配为4×3，窄屏3×4，每次新局洗牌六组配对。每张卡同时使用颜色与符号，不能只依赖颜色。最多揭开两张未配对卡，匹配保持揭开，不匹配700毫秒后翻回，等待时锁定输入。统计尝试和已配对组数，六组全部完成显示胜利。包含开始说明、暂停遮蔽未配对卡、重开重置并洗牌。支持鼠标、触屏、键盘焦点与回车空格，无时间压力，不依赖外部素材。",
        "materials": {
          "character": {
            "title": "谜题向导米洛",
            "content": "亲切而克制的向导，介绍规则并祝贺配对成功。",
            "specifications": {
              "appearance": "暖灰小猫头鹰徽章、琥珀围巾、简洁线条，放在卡牌网格之外。",
              "personality": "耐心鼓励，不泄露答案，也不打断正在进行的操作。",
              "abilities": "解释两张翻牌规则，报告剩余组数，完成后祝贺但不控制游戏。"
            }
          },
          "scene": {
            "title": "安静谜题桌",
            "content": "安静高对比桌面围住棋盘，让注意力停留在卡牌。",
            "specifications": {
              "environment": "炭灰桌面、暖中性色面板，不使用动态背景。",
              "layout": "十二张等距卡牌，顶部显示尝试和进度，重开暂停与卡牌触控区分离。",
              "camera": "固定俯视棋盘，桌面4×3，移动端3×4，不能裁切。"
            }
          },
          "prop": {
            "title": "六组符号卡牌",
            "content": "每组同时使用独立符号与颜色，不用依赖单一颜色也能辨认配对关系。",
            "specifications": {
              "usage": "圆、三角、方块、新月、菱形、十字，各对应不同柔和暖色。",
              "interaction": "揭开一至两张，匹配保持正面，不匹配在受控延迟后翻回。",
              "rules": "每种符号恰好两张，每次新局洗牌，忽略已配对卡和翻回等待时点击。"
            }
          },
          "audio": {
            "title": "配对反馈音",
            "content": "轻而愉悦的声音强化选择，不制造压力。",
            "specifications": {
              "mood": "可选的安静拨弦音，无紧迫计时、滴答或循环警报。",
              "trigger": "一次翻牌轻响、两音匹配铃、柔和不匹配提示和短完成旋律。",
              "mixing": "每次有效翻牌只响一次，避免长音叠加，操作后解锁，均可静音。"
            }
          }
        },
        "output": {
          "title": "色彩记忆游戏",
          "content": "验收：恰好六组；双击不能重复揭开；不匹配期间锁定输入；重开取消待执行计时器；完成只触发一次；键盘可操作。"
        },
        "steps": [
          "检查符号与翻牌规则",
          "适配触屏和键盘棋盘",
          "生成并测试翻回与重开时序"
        ]
      }
    },
    "legacyPrompts": [
      "制作一个完整可玩的 2048 类数字合并益智游戏，4x4 棋盘，方向键和触屏滑动控制，同值合并，每次有效移动产生新数字。显示分数、最高分、规则、重开按钮，胜利与无路可走状态。采用精致的深色背景、温暖渐变方块、流畅动画。"
    ]
  },
  {
    "id": "cozy-farm",
    "name": "Pocket Harvest",
    "title": "Pocket Harvest",
    "genre": "simulation",
    "theme": "#ffc993",
    "description": "A small playable farm economy with three crops, growing plots, and an achievable harvest goal.",
    "prompt": "Build a complete lightweight farm management game with an explicit grow-and-reinvest loop. Start with 20 coins and two unlocked plots. Offer carrot (cost 4, yield 7, grow 5 seconds), corn (cost 8, yield 14, grow 10 seconds), and pumpkin (cost 12, yield 22, grow 16 seconds). Clicking an empty plot plants the selected affordable crop; mature plots harvest once. Unlock each extra plot for 25 coins, up to six. Target 100 coins and four unlocked plots; show a clear achievement state but allow continued play. Crop growth uses elapsed time, not frame count. Include instructions, coin balance, growth progress, selected crop, restart, pause, and touch-friendly controls. Prevent negative coins, repeated harvest, or permanent economic deadlocks.",
    "tags": [
      "Three crops",
      "Plot upgrades",
      "Balanced economy"
    ],
    "estimatedMinutes": 12,
    "steps": [
      "Review crop timing and economy",
      "Arrange plots and crop states",
      "Generate and verify the full reinvestment loop"
    ],
    "materials": {
      "character": {
        "title": "Rowan the gardener",
        "content": "A welcoming gardener helps make the farm feel inhabited without blocking plot controls.",
        "specifications": {
          "appearance": "Small pixel gardener, straw hat, rolled sleeves, warm green overalls, visible watering-can accent.",
          "personality": "Practical and cheerful; offers one concise planting hint and a milestone congratulation.",
          "abilities": "Selected crop and affordable actions are visible; guidance never spends coins or auto-harvests."
        }
      },
      "scene": {
        "title": "Pocket garden",
        "content": "A compact garden fits every plot, upgrade, and crop selector on a small screen.",
        "specifications": {
          "environment": "Warm daylight, soil browns and restrained leaf greens; plain panel background keeps the economy readable.",
          "layout": "Two starting plots in a six-plot garden; crop selector at bottom; coin and milestone counters at top.",
          "camera": "Fixed three-quarter/near top-down view; no camera movement; all six plots stay touch-accessible."
        }
      },
      "prop": {
        "title": "Crop seed catalog",
        "content": "Three distinct crops provide meaningful timing and profit tradeoffs.",
        "specifications": {
          "usage": "Carrot, corn, and pumpkin seed packets; empty, seedling, growing, and mature plot states are distinct.",
          "interaction": "Spend seed cost at planting; mature crop gains yield once; extra plots bought separately.",
          "rules": "Carrot 4→7 in 5s; corn 8→14 in 10s; pumpkin 12→22 in 16s; new plot 25; prevent unaffordable actions."
        }
      },
      "audio": {
        "title": "Harvest sound direction",
        "content": "Warm tactile feedback supports a calm, understandable economic loop.",
        "specifications": {
          "mood": "Soft acoustic plucks and light garden ambience at low volume.",
          "trigger": "Seed placement click, short growth-ready cue, harvest coin chime, upgrade and goal-complete phrase.",
          "mixing": "At most one readiness cue per crop; user interaction unlocks audio; paused growth and audio resume together."
        }
      }
    },
    "output": {
      "title": "Pocket Harvest game",
      "content": "Acceptance: economics use the listed values; pause freezes growth; no double harvest; insufficient coins cannot spend; restart restores 20 coins and two plots; milestone requires both coins and plots."
    },
    "settings": {
      "genre": "simulation",
      "visualStyle": "pixel",
      "language": "en"
    },
    "locales": {
      "zh": {
        "name": "口袋丰收",
        "description": "通过三种作物、扩展地块与可完成收获目标，打造真正可玩的农场经济循环。",
        "prompt": "制作完整轻量农场经营，明确种植、收获和再投资循环。初始20金币、两块已解锁地。胡萝卜成本4收益7生长5秒，玉米成本8收益14生长10秒，南瓜成本12收益22生长16秒。点击空地种选中且买得起作物，成熟只收获一次。每块新地25金币，最多六块。目标100金币且四块地，达成后显示成就并允许继续。生长使用实际经过时间而非帧数。包含说明、金币、生长进度、选中作物、重开、暂停与触屏操作。避免负金币、重复收获和经济死锁。",
        "materials": {
          "character": {
            "title": "园丁罗文",
            "content": "亲切园丁让农场有人气，但不遮挡地块操作。",
            "specifications": {
              "appearance": "小像素园丁、草帽、卷袖、暖绿色工装，带清晰浇水壶点缀。",
              "personality": "务实开朗，提供简短种植提示和里程碑祝贺。",
              "abilities": "显示选中作物和可负担操作，引导不能自动花钱或收获。"
            }
          },
          "scene": {
            "title": "口袋花园",
            "content": "紧凑花园在小屏幕内展示地块、扩建和作物选择。",
            "specifications": {
              "environment": "暖白天光、土棕与克制叶绿，简洁面板使经济信息清晰。",
              "layout": "六块地中初始开放两块，底部作物选择，顶部金币和里程碑。",
              "camera": "固定接近俯视的四分之三视角，无镜头移动，六块地均可触控。"
            }
          },
          "prop": {
            "title": "作物种子目录",
            "content": "三种作物提供生长时间与利润取舍。",
            "specifications": {
              "usage": "胡萝卜、玉米、南瓜种袋，空地、幼苗、生长、成熟阶段有区分。",
              "interaction": "种植扣成本，成熟收益只发放一次，新地单独购买。",
              "rules": "胡萝卜4到7生长5秒，玉米8到14生长10秒，南瓜12到22生长16秒，新地25，禁止买不起的操作。"
            }
          },
          "audio": {
            "title": "丰收声音",
            "content": "温暖触感反馈支持安静清楚的经营循环。",
            "specifications": {
              "mood": "低音量柔和木吉他拨弦与园地氛围。",
              "trigger": "落种点击、短成熟提示、收获金币铃、扩建与目标完成旋律。",
              "mixing": "每株只响一次成熟提示，交互解锁音频，暂停后生长与声音同步继续。"
            }
          }
        },
        "output": {
          "title": "口袋丰收游戏",
          "content": "验收：经济使用列出的值；暂停冻结生长；不能重复收获；不足金币不能花费；重开恢复20金币两块地；目标需同时满足金币和地块。"
        },
        "steps": [
          "检查作物时间与经济数值",
          "安排地块与作物状态",
          "生成并验证完整再投资循环"
        ]
      }
    },
    "legacyPrompts": [
      "制作一个完整可玩的轻量农场经营游戏。玩家点击地块播种，等待成熟后收获获得金币，再购买新地块与更高价值作物。清楚显示金币、作物阶段、升级费用与目标。使用温暖的像素/插画风，具备帮助说明、重置按钮和触屏适配。至少有3种作物与合理的经济数值，不能只做静态界面。"
    ]
  },
  {
    "id": "blank",
    "name": "Adventure Starter",
    "title": "Adventure Starter",
    "genre": "custom",
    "theme": "#b6c1c8",
    "description": "An editable collecting-adventure kit with a real goal, clean material roles, and space for your own world.",
    "prompt": "Use this starting direction, then customize its character, scene, props, and audio. Build a complete top-down collecting adventure: move with WASD/arrows or a touch directional pad, collect three trail tokens in a small reachable map, and return to the marked camp to win. Include one avoidable hazard, a visible token counter, clear instructions, start, pause, win/loss, and restart. Prioritize a coherent readable world over extra mechanics. Use the connected material specifications and bound references as the design source. Every token should be reachable and count once; restarting resets the entire run.",
    "tags": [
      "Editable direction",
      "Collecting goal",
      "Your own references"
    ],
    "estimatedMinutes": 9,
    "steps": [
      "Replace the world and protagonist direction",
      "Bind your own material reference files",
      "Generate a first draft and refine the goal"
    ],
    "materials": {
      "character": {
        "title": "Your explorer",
        "content": "Replace this explorer with your own protagonist and bind its actual visual references.",
        "specifications": {
          "appearance": "Readable small explorer silhouette, one light garment accent, visible facing direction; customize outfit and palette.",
          "personality": "Determined but gentle; movement and idle behavior reflect the personality you choose.",
          "abilities": "Eight-direction or four-direction walking; no required combat; collision stays smaller than the visible sprite."
        }
      },
      "scene": {
        "title": "Your adventure map",
        "content": "A small purposeful map makes a first playable game easy to finish and refine.",
        "specifications": {
          "environment": "Choose one world theme and two dominant colors; keep ground quieter than characters and pickups.",
          "layout": "Camp at center or safe edge, three reachable token locations, one avoidable hazard, no blocked objectives.",
          "camera": "Fixed top-down view with the entire first map visible; adapt size while preserving touch targets."
        }
      },
      "prop": {
        "title": "Trail tokens and camp marker",
        "content": "Customize the collectible identity and return point while preserving a clear goal.",
        "specifications": {
          "usage": "Three distinct-position tokens sharing one visual design, plus a clearly labeled camp marker.",
          "interaction": "Touch each token to collect it once; camp triggers victory only after all three are collected.",
          "rules": "Exactly three tokens; counter 0/3 to 3/3; no duplicate rewards; hazard loss and victory are mutually exclusive."
        }
      },
      "audio": {
        "title": "Your sound palette",
        "content": "Choose a small sound vocabulary that supports the world and the collecting loop.",
        "specifications": {
          "mood": "One calm background direction appropriate to your world; optional ambience.",
          "trigger": "Short pickup cue, distinct return-to-camp win phrase, one hazard cue; avoid unnecessary voice narration.",
          "mixing": "Audio begins after input, all cues can be muted, pause stops background and prevents new cues."
        }
      }
    },
    "output": {
      "title": "Your adventure game",
      "content": "Acceptance: all three tokens are reachable and counted once; camp requires all three; a hazard is avoidable; keyboard and touch work; pause and restart preserve correct state boundaries."
    },
    "settings": {
      "genre": "custom",
      "visualStyle": "illustration",
      "language": "en"
    },
    "locales": {
      "zh": {
        "name": "冒险创作起点",
        "description": "具有真实目标、清晰素材分工且便于替换世界观的收集冒险起点。",
        "prompt": "以此为起点，再替换人物、场景、道具和声音。制作完整俯视收集冒险：WASD、方向键或触屏方向键移动，在可抵达的小地图收集三枚路标，再返回标记营地获胜。包含一种可避开的危险、道具计数、说明、开始、暂停、胜负和重开。优先保持世界一致清晰，不堆叠额外机制。使用连接的素材设定与绑定参考作为设计依据，每枚路标可抵达且只计数一次，重开完整重置。",
        "materials": {
          "character": {
            "title": "你的探险者",
            "content": "替换成自己的主角，并绑定真实视觉参考图。",
            "specifications": {
              "appearance": "清晰小探险者轮廓、一处浅色服饰点缀、可见朝向，自定义服装与配色。",
              "personality": "坚定温和，移动与待机行为体现你选定的性格。",
              "abilities": "四向或八向行走，不强制战斗，碰撞范围略小于显示精灵。"
            }
          },
          "scene": {
            "title": "你的冒险地图",
            "content": "有目的的小地图，让首个可玩版本容易完成与打磨。",
            "specifications": {
              "environment": "选择一种世界主题与两个主色，地面比人物和收集物安静。",
              "layout": "营地在中心或安全边缘，三枚可抵达路标，一种可避危险，没有封死目标。",
              "camera": "固定俯视，首张地图完整可见，适配尺寸并保留触控目标。"
            }
          },
          "prop": {
            "title": "路标与营地标记",
            "content": "自定义收集物和返回点，保持目标明确。",
            "specifications": {
              "usage": "三处路标采用统一视觉设计，营地标記清晰且有文字。",
              "interaction": "触碰路标每枚只计一次，营地仅在收集三枚后触发胜利。",
              "rules": "恰好三枚，计数从0/3到3/3，无重复奖励，危险失败与胜利互斥。"
            }
          },
          "audio": {
            "title": "你的声音调色板",
            "content": "选择支持世界与收集循环的小型声音语汇。",
            "specifications": {
              "mood": "符合世界的一种安静背景方向，可选氛围声。",
              "trigger": "短拾取提示、独立回营胜利旋律、一种危险音，避免多余旁白。",
              "mixing": "输入后开始音频，全部可静音，暂停停止背景并禁止新音效。"
            }
          }
        },
        "output": {
          "title": "你的冒险游戏",
          "content": "验收：三枚路标可抵达且只计一次；营地需全收集；危险可避；键盘触屏可用；暂停与重开保持正确状态边界。"
        },
        "steps": [
          "替换世界与主角方向",
          "绑定自己的素材参考文件",
          "生成首稿并打磨目标"
        ]
      }
    },
    "legacyPrompts": []
  }
].map(template => ({ ...template, settings: { ...DEFAULT_SETTINGS, ...template.settings } }));

function shell(title, instructions, code, accent = '#c9ff5b') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;background:#0c0f16;color:#f4f5f6;font:15px system-ui;display:flex;flex-direction:column;align-items:center;min-height:100vh}header{width:min(960px,100%);padding:18px 22px;display:flex;justify-content:space-between;gap:12px;align-items:center}h1{font-size:20px;margin:0}small{color:#99a0af}button{background:${accent};color:#10141a;border:0;border-radius:9px;padding:10px 16px;font-weight:700;cursor:pointer}canvas{width:min(960px,100%);aspect-ratio:16/9;display:block;touch-action:none;border:1px solid #303543;border-radius:14px;background:#121824}footer{padding:14px;display:flex;gap:12px;align-items:center;color:#a6adba;text-align:center;flex-wrap:wrap;justify-content:center}.controls{display:flex;gap:10px}.controls button{min-width:70px}#status{color:${accent}}@media(max-width:600px){header{padding:14px}h1{font-size:16px}footer{font-size:12px}}</style></head><body><header><div><h1>${title}</h1><small>GameStudio · 本地可玩示例</small></div><button id="restart">重新开始</button></header><canvas id="game" width="960" height="540" aria-label="${title}游戏画布"></canvas><footer><span>${instructions}</span><span id="status"></span><div class="controls" id="touch"></div></footer><script>${code}</script></body></html>`;
}

const runner = shell('NEON DRIFT · 霓虹疾跑', '空格 / 点击跳跃 · P 暂停 · 避开障碍，收集能量', `
const c=document.getElementById('game'),x=c.getContext('2d'),s=document.getElementById('status');let y,vy,ob,orbs,score,tick,over,pause,speed,jumps;function reset(){y=390;vy=0;ob=[];orbs=[];score=0;tick=0;over=false;pause=false;speed=5;jumps=0;s.textContent='点击画面或按空格跳跃'}reset();function jump(){if(over){reset();return}if(!pause&&jumps<2){vy=-12;jumps++}}document.getElementById('restart').onclick=reset;c.onpointerdown=jump;document.addEventListener('keydown',e=>{if(['Space','ArrowUp'].includes(e.code)){e.preventDefault();jump()}if(e.code==='KeyP')pause=!pause});let last=0;function frame(time){let dt=Math.min((time-last)/16.67||1,2);last=time;if(!over&&!pause){tick+=dt;score+=dt*.1;speed=5+Math.min(score/90,5);vy+=.55*dt;y+=vy*dt;if(y>=390){y=390;vy=0;jumps=0}if(tick>85){tick=0;ob.push({x:980,w:30+Math.random()*25,h:35+Math.random()*45});orbs.push({x:1130,y:280+Math.random()*60})}for(let o of ob){o.x-=speed*dt;if(o.x<170&&o.x+o.w>135&&y+40>430-o.h)over=true}for(let o of orbs){o.x-=speed*dt;if(Math.hypot(o.x-150,o.y-(y+20))<33&&!o.got){o.got=true;score+=10}}ob=ob.filter(o=>o.x>-80);orbs=orbs.filter(o=>o.x>-50)}x.fillStyle='#101520';x.fillRect(0,0,960,540);for(let i=0;i<24;i++){let bx=(i*74-score*2)%1060-60;x.fillStyle=i%2?'#202b3a':'#172236';x.fillRect(bx,180+(i%5)*20,45,250)}x.strokeStyle='#394650';for(let a=0;a<960;a+=60){x.beginPath();x.moveTo(a,430);x.lineTo(a-180,540);x.stroke()}x.fillStyle='#253b2e';x.fillRect(0,430,960,3);x.shadowBlur=18;x.shadowColor='#c9ff5b';x.fillStyle='#c9ff5b';x.fillRect(135,y,30,40);x.shadowColor='#b286ff';x.fillStyle='#b286ff';for(let o of ob)x.fillRect(o.x,430-o.h,o.w,o.h);x.fillStyle='#c9ff5b';x.shadowColor='#c9ff5b';for(let o of orbs)if(!o.got){x.beginPath();x.arc(o.x,o.y,9,0,Math.PI*2);x.fill()}x.shadowBlur=0;x.fillStyle='#fff';x.font='bold 25px system-ui';x.fillText('SCORE '+Math.floor(score),28,45);if(over||pause){x.fillStyle='#0009';x.fillRect(0,0,960,540);x.textAlign='center';x.fillStyle='#fff';x.font='bold 34px system-ui';x.fillText(over?'本次得分 '+Math.floor(score):'已暂停',480,250);x.font='18px system-ui';x.fillText(over?'点击 / 空格重新开始':'按 P 继续',480,290);x.textAlign='left'}s.textContent=over?'挑战结束':pause?'已暂停':'分数 '+Math.floor(score);requestAnimationFrame(frame)}requestAnimationFrame(frame);
`);

const space = shell('ORBIT GUARD · 星际守卫', '方向键 / WASD 或拖动飞船 · 自动射击 · P 暂停', `
const c=document.getElementById('game'),x=c.getContext('2d'),s=document.getElementById('status'),keys={};let player,enemies,shots,score,life,tick,shoot,over,pause;function reset(){player={x:480,y:470};enemies=[];shots=[];score=0;life=3;tick=0;shoot=0;over=false;pause=false}reset();document.getElementById('restart').onclick=reset;document.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code))e.preventDefault();keys[e.code]=true;if(e.code==='KeyP')pause=!pause});document.addEventListener('keyup',e=>keys[e.code]=false);let dragging=false;function aim(e){let r=c.getBoundingClientRect();player.x=Math.max(20,Math.min(940,(e.clientX-r.left)/r.width*960));player.y=Math.max(60,Math.min(510,(e.clientY-r.top)/r.height*540))}c.onpointerdown=e=>{if(over)reset();dragging=true;c.setPointerCapture(e.pointerId);aim(e)};c.onpointermove=e=>{if(dragging)aim(e)};c.onpointerup=()=>dragging=false;window.addEventListener('blur',()=>{for(const k in keys)keys[k]=false;dragging=false});let last=0;function frame(tm){let dt=Math.min((tm-last)/16.67||1,2);last=tm;if(!over&&!pause){player.x+=((keys.ArrowRight||keys.KeyD?1:0)-(keys.ArrowLeft||keys.KeyA?1:0))*6*dt;player.y+=((keys.ArrowDown||keys.KeyS?1:0)-(keys.ArrowUp||keys.KeyW?1:0))*6*dt;player.x=Math.max(20,Math.min(940,player.x));player.y=Math.max(50,Math.min(510,player.y));tick+=dt;shoot+=dt;if(shoot>13){shoot=0;shots.push({x:player.x,y:player.y-23})}if(tick>Math.max(22,65-score*.2)){tick=0;enemies.push({x:30+Math.random()*900,y:-30,v:2+Math.random()*2+score*.008,r:14+Math.random()*10})}for(let a of shots)a.y-=10*dt;for(let a of enemies){a.y+=a.v*dt;if(Math.hypot(a.x-player.x,a.y-player.y)<a.r+16){a.dead=true;life--}if(a.y>580){a.dead=true;life--}for(let b of shots)if(!a.dead&&!b.dead&&Math.hypot(a.x-b.x,a.y-b.y)<a.r+5){a.dead=true;b.dead=true;score+=10}}enemies=enemies.filter(a=>!a.dead);shots=shots.filter(a=>!a.dead&&a.y>-30);if(life<=0)over=true}x.fillStyle='#101324';x.fillRect(0,0,960,540);x.fillStyle='#5f709a';for(let i=0;i<90;i++){let ax=(i*83)%960,ay=(i*107+tm*.015)%540;x.fillRect(ax,ay,i%5===0?2:1,2)}x.shadowBlur=16;x.shadowColor='#91b7ff';x.fillStyle='#91b7ff';x.beginPath();x.moveTo(player.x,player.y-23);x.lineTo(player.x+19,player.y+18);x.lineTo(player.x,player.y+9);x.lineTo(player.x-19,player.y+18);x.closePath();x.fill();x.fillStyle='#c9ff5b';for(let a of shots)x.fillRect(a.x-2,a.y,4,14);x.fillStyle='#f88fbc';x.shadowColor='#f88fbc';for(let a of enemies){x.beginPath();x.arc(a.x,a.y,a.r,0,Math.PI*2);x.fill()}x.shadowBlur=0;x.fillStyle='#fff';x.font='bold 23px system-ui';x.fillText('SCORE '+score,25,40);x.fillText('♥ '.repeat(Math.max(life,0)),790,40);if(over||pause){x.fillStyle='#000a';x.fillRect(0,0,960,540);x.textAlign='center';x.font='bold 34px system-ui';x.fillStyle='#fff';x.fillText(over?'守卫结束 · '+score+' 分':'已暂停',480,255);x.font='18px system-ui';x.fillText(over?'点击重新出发':'按 P 继续',480,290);x.textAlign='left'}s.textContent='生命 '+Math.max(life,0)+' / 3';requestAnimationFrame(frame)}requestAnimationFrame(frame);
`, '#91b7ff');

const memory = shell('COLOR MEMORY · 色彩记忆', '点击两张卡片寻找相同图案 · 完成全部配对', `
const c=document.getElementById('game'),x=c.getContext('2d'),s=document.getElementById('status');const colors=['#ff8bb1','#ffca85','#a8eaa9','#91b7ff','#cdb0ff','#80e1d8'];let cards,first,lock,turns,matches,pending;function reset(){clearTimeout(pending);cards=[...colors,...colors].sort(()=>Math.random()-.5).map(color=>({color,open:false,done:false}));first=null;lock=false;turns=0;matches=0}reset();document.getElementById('restart').onclick=reset;function rect(i){return{x:144+(i%4)*174,y:65+Math.floor(i/4)*143,w:150,h:120}}c.onpointerdown=e=>{if(lock)return;let r=c.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*960,py=(e.clientY-r.top)/r.height*540;let i=cards.findIndex((a,j)=>{let q=rect(j);return px>q.x&&px<q.x+q.w&&py>q.y&&py<q.y+q.h});if(i<0||cards[i].open||cards[i].done)return;cards[i].open=true;if(first===null){first=i;return}turns++;let a=first,b=i;first=null;if(cards[a].color===cards[b].color){cards[a].done=cards[b].done=true;matches++;return}lock=true;pending=setTimeout(()=>{cards[a].open=cards[b].open=false;lock=false},650)};function frame(){x.fillStyle='#15141f';x.fillRect(0,0,960,540);cards.forEach((a,i)=>{let q=rect(i);x.fillStyle=a.done?'#253f36':a.open?a.color:'#292a3b';x.beginPath();x.roundRect(q.x,q.y,q.w,q.h,13);x.fill();x.strokeStyle=a.done?'#a8eaa9':'#3a3c53';x.stroke();x.textAlign='center';x.textBaseline='middle';x.font='bold 36px system-ui';x.fillStyle=a.open||a.done?'#20212d':'#65697f';x.fillText(a.done?'✓':a.open?'●':'?',q.x+q.w/2,q.y+q.h/2)});x.textAlign='left';x.textBaseline='alphabetic';x.fillStyle='#ccc';x.font='18px system-ui';x.fillText('配对 '+matches+'/6',30,35);x.fillText('步数 '+turns,800,35);s.textContent=matches===6?'全部完成！用了 '+turns+' 步':'已完成 '+matches+' / 6';if(matches===6){x.fillStyle='#0009';x.fillRect(0,460,960,80);x.textAlign='center';x.fillStyle='#a8eaa9';x.font='bold 22px system-ui';x.fillText('恭喜完成 · 点击「重新开始」再挑战',480,508)}requestAnimationFrame(frame)}requestAnimationFrame(frame);
`, '#ffca91');

export const DEMOS = [
  { name: '霓虹疾跑', description: '横版跑酷 · 本地可玩示例', templateId: 'neon-runner', title: 'NEON DRIFT · 霓虹疾跑', summary: '二段跳、随机障碍、能量收集与递增难度的跑酷示例。', controls: '空格 / 点击跳跃，P 暂停，点击重开', html: runner, theme: '#c9ff5b', genre: 'runner' },
  { name: '星际守卫', description: '太空射击 · 本地可玩示例', templateId: 'space-defender', title: 'ORBIT GUARD · 星际守卫', summary: '自动射击、敌人波次、生命与得分的星空射击示例。', controls: '方向键 / WASD 或拖动移动，P 暂停', html: space, theme: '#91b7ff', genre: 'shooter' },
  { name: '色彩记忆', description: '益智配对 · 本地可玩示例', templateId: 'tile-puzzle', title: 'COLOR MEMORY · 色彩记忆', summary: '寻找相同颜色的卡片，完成六组配对的记忆示例。', controls: '点击卡片配对，点击重新开始重置', html: memory, theme: '#ffca91', genre: 'puzzle' },
];
