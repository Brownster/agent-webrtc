/* global chrome */

// Use direct references to shared modules to avoid const declaration conflicts

let currentOptions = {}

// Load options from storage
async function loadOptions () {
  try {
    currentOptions = await window.WebRTCExporterStorage.StorageManager.getOptions()

    // Populate form fields
    document.getElementById('url').value = currentOptions.url || ''
    document.getElementById('username').value = currentOptions.username || ''
    document.getElementById('password').value = currentOptions.password || ''
    document.getElementById('updateInterval').value = currentOptions.updateInterval || 2
    document.getElementById('job').value = currentOptions.job || 'webrtc-internals-exporter'
    document.getElementById('agentId').value = currentOptions.agentId || ''
    document.getElementById('gzip').checked = currentOptions.gzip || false

    // Set enabled stats checkboxes
    const enabledStats = Array.isArray(currentOptions.enabledStats)
      ? currentOptions.enabledStats
      : Object.values(currentOptions.enabledStats || {})

    document.querySelectorAll('input[name="enabledStats"]').forEach(checkbox => {
      checkbox.checked = enabledStats.includes(checkbox.value)
    })

    // Render domains list
    renderDomainsList()
  } catch (error) {
    console.error('Error loading options:', error)
  }
}

// Save options to storage
async function saveOptions () {
  try {
    const formData = new FormData(document.getElementById('optionsForm'))

    // Get enabled stats
    const enabledStats = []
    document.querySelectorAll('input[name="enabledStats"]:checked').forEach(checkbox => {
      enabledStats.push(checkbox.value)
    })

    const options = {
      url: formData.get('url'),
      username: formData.get('username'),
      password: formData.get('password'),
      updateInterval: parseInt(formData.get('updateInterval')),
      job: formData.get('job'),
      agentId: formData.get('agentId'),
      gzip: formData.has('gzip'),
      enabledStats,
      enabledOrigins: currentOptions.enabledOrigins || {}
    }

    await window.WebRTCExporterStorage.StorageManager.set(options)
    currentOptions = options

    // Show success message
    const successMessage = document.getElementById('successMessage')
    successMessage.style.display = 'block'
    setTimeout(() => {
      successMessage.style.display = 'none'
    }, 3000)
  } catch (error) {
    console.error('Error saving options:', error)
    alert('Error saving options: ' + error.message)
  }
}

// Toggle domain enable/disable
async function toggleDomain (item) {
  const domain = item.origin || item // Support both object and string format
  const origins = { ...currentOptions.enabledOrigins }

  if (window.WebRTCExporterDomains.TARGET_DOMAINS.includes(domain)) {
    // For target domains, toggle between auto-enabled (undefined) and disabled (false)
    if (origins[domain] === false) {
      delete origins[domain] // Remove to allow auto-enable
    } else {
      origins[domain] = false // Explicitly disable
    }
  } else {
    // For manual origins, toggle between enabled and disabled
    origins[domain] = !origins[domain]
  }

  currentOptions.enabledOrigins = origins
  await window.WebRTCExporterStorage.StorageManager.updateOptions({ enabledOrigins: origins })
  renderDomainsList()
}

// Render the domains list
function renderDomainsList () {
  const container = document.getElementById('domainsList')

  // Get all origins (target domains + any manually added ones)
  const allOrigins = new Set([
    ...Object.keys(currentOptions.enabledOrigins || {}),
    ...window.WebRTCExporterDomains.TARGET_DOMAINS
  ])

  container.innerHTML = ''

  Array.from(allOrigins).forEach(origin => {
    const isTargetDomain = window.WebRTCExporterDomains.TARGET_DOMAINS.includes(origin)
    const explicitSetting = currentOptions.enabledOrigins[origin]

    let status
    let statusClass

    if (explicitSetting === false) {
      status = 'Disabled'
      statusClass = 'disabled'
    } else if (explicitSetting === true) {
      status = 'Enabled'
      statusClass = 'enabled'
    } else if (isTargetDomain) {
      status = 'Auto-enabled'
      statusClass = 'auto-enabled'
    } else {
      status = 'Manual'
      statusClass = 'manual'
    }

    const domainItem = document.createElement('div')
    domainItem.className = 'domain-item'

    const buttonHtml = isTargetDomain || explicitSetting !== undefined
      ? `<button type="button" class="toggle-btn" data-domain="${origin}">
        ${status === 'Disabled' ? 'Enable' : 'Disable'}
      </button>`
      : ''

    domainItem.innerHTML = `
      <div>
        <strong>${origin}</strong>
        <span class="status ${statusClass}">${status}</span>
      </div>
      <div>
        ${buttonHtml}
      </div>
    `

    console.log('Generated HTML for', origin, ':', domainItem.innerHTML)
    container.appendChild(domainItem)
  })
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  loadOptions()

  document.getElementById('optionsForm').addEventListener('submit', (e) => {
    e.preventDefault()
    saveOptions()
  })

  // Add event delegation for domain toggle buttons
  document.getElementById('domainsList').addEventListener('click', async (e) => {
    console.log('Domain list clicked:', e.target)
    if (e.target.classList.contains('toggle-btn')) {
      const domain = e.target.getAttribute('data-domain')
      console.log('Toggle button clicked for domain:', domain)
      if (domain) {
        await toggleDomain({ origin: domain })
      }
    }
  })
})
