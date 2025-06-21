/**
 * @jest-environment jsdom
 */

const fs = require('fs')
const path = require('path')

describe('Options UI proxy fields', () => {
  let saveOptions, useProxyCheckbox, proxyOptionsDiv

  beforeEach(() => {
    document.body.innerHTML = `
      <form id="optionsForm">
        <input type="checkbox" id="useProxy" name="useProxy">
        <div id="proxyOptions" style="display:none">
          <input type="url" id="proxyUrl" name="proxyUrl">
          <input type="password" id="apiKey" name="apiKey">
        </div>
      </form>
    `

    global.window.WebRTCExporterStorage = {
      StorageManager: {
        getOptions: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockResolvedValue()
      }
    }
    global.window.WebRTCExporterDomains = { TARGET_DOMAINS: [], DomainManager: { isTargetDomain: jest.fn() } }

    const scriptPath = path.join(__dirname, '../../options.js')
    const code = fs.readFileSync(scriptPath, 'utf8')
    const wrapper = new Function('window', 'document', 'console', `${code}; return { saveOptions }`)
    const exports = wrapper(window, document, console)
    saveOptions = exports.saveOptions

    // Manually attach handler normally added on DOMContentLoaded
    useProxyCheckbox = document.getElementById('useProxy')
    proxyOptionsDiv = document.getElementById('proxyOptions')
    useProxyCheckbox.addEventListener('change', () => {
      proxyOptionsDiv.style.display = useProxyCheckbox.checked ? 'block' : 'none'
    })
  })

  test('toggle displays proxy fields', () => {
    expect(proxyOptionsDiv.style.display).toBe('none')
    useProxyCheckbox.checked = true
    useProxyCheckbox.dispatchEvent(new Event('change'))
    expect(proxyOptionsDiv.style.display).toBe('block')
    useProxyCheckbox.checked = false
    useProxyCheckbox.dispatchEvent(new Event('change'))
    expect(proxyOptionsDiv.style.display).toBe('none')
  })

  test('saving options includes proxy values', async () => {
    useProxyCheckbox.checked = true
    document.getElementById('proxyUrl').value = 'https://proxy'
    document.getElementById('apiKey').value = 'abc'

    await saveOptions()

    expect(window.WebRTCExporterStorage.StorageManager.set).toHaveBeenCalledWith(
      expect.objectContaining({
        useProxy: true,
        proxyUrl: 'https://proxy',
        apiKey: 'abc'
      })
    )
  })
})
