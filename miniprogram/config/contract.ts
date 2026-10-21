// 由 scripts/contract.mjs 从 shared/contract.json 生成，不要手改。
export const CONTRACT = {
  "categories": [
    "食费",
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
  "dishTags": [
    "在家做",
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
    "wishPlan": 200,
    "dateTitle": 20
  }
} as const;
