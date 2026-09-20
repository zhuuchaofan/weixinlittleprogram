Component({
  properties: {
    label: { type: String, value: '返回上一页' },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    back() {
      if (!this.data.disabled) this.triggerEvent('back');
    },
  },
});
