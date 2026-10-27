// 由 scripts/contract.mjs 从 shared/contract.json 生成，不要手改。
export const CONTRACT = {
  "categories": [
    "吃饭",
    "日用",
    "房租",
    "水电网",
    "交通",
    "娱乐",
    "旅行",
    "猫咪",
    "其他"
  ],
  "settlement": "结算",
  "categoryAliases": {
    "食费": "吃饭"
  },
  "payers": [
    "a",
    "b"
  ],
  "splits": [
    "half",
    "other",
    "self",
    "ratio"
  ],
  "flows": [
    "out",
    "in"
  ],
  "billApps": [
    "wechat",
    "alipay"
  ],
  "billImport": {
    "maxImages": 9,
    "maxItems": 100
  },
  "ai": {
    "billImage": {
      "name": "截图记账",
      "verb": "识别",
      "unit": "张",
      "what": "截图",
      "per": "day",
      "free": 5,
      "vip": 100
    },
    "summary": {
      "name": "喵喵小结",
      "verb": "生成",
      "unit": "次",
      "what": "小结",
      "per": "day",
      "free": 5,
      "vip": 30
    }
  },
  "vip": {
    "plans": [
      {
        "id": "vip_month",
        "name": "月度会员",
        "days": 31,
        "price": 900
      },
      {
        "id": "vip_year",
        "name": "年度会员",
        "days": 366,
        "price": 6800
      }
    ]
  },
  "ratio": {
    "min": 0,
    "max": 100
  },
  "todoKinds": [
    "shop",
    "todo",
    "chore"
  ],
  "todoWho": [
    "a",
    "b",
    "both"
  ],
  "dishKinds": [
    "dish",
    "shop"
  ],
  "dishTags": [
    "在家做",
    "外食",
    "外卖"
  ],
  "shopTags": [
    "外食",
    "外卖"
  ],
  "maxAmount": 1000000000,
  "lengths": {
    "expenseNote": 40,
    "todoText": 60,
    "dishName": 20,
    "wishTitle": 30,
    "wishWhy": 100,
    "wishPlan": 300,
    "dateTitle": 20,
    "goalTitle": 20
  }
} as const;
