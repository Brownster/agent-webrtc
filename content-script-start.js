/* global chrome */

const s = document.createElement('script')
s.src = chrome.runtime.getURL('override-stage1.js')
(document.head || document.documentElement).appendChild(s)
s.onload = () => s.remove()
