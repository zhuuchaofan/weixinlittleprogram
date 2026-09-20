Component({
  properties: {
    saveLabel: { type: String, value: '保存草稿' },
    publishLabel: { type: String, value: '更新展示' },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    save() {
      if (!this.data.disabled) this.triggerEvent('save');
    },
    publish() {
      if (!this.data.disabled) this.triggerEvent('publish');
    },
  },
});
