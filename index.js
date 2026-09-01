(function () {
  const EXT_KEY = 'auto_instruction_appender';
  
  const DEFAULT_INSTRUCTIONS = [
    '(Chỉ có hiệu lực đối với nội dung bên trong thẻ <content></content>: Vui lòng tạo một bài viết dài trên 2500 chữ. Yêu cầu gộp các đoạn văn vụn vặt, giữ cho các đoạn văn dài ngắn đan xen nhịp nhàng, giới hạn tối đa "đoạn văn chỉ có một câu" trong toàn bài là 5.)',
    '(Bắt buộc phải xuất MVU mới nhất ở cuối. Nghiêm cấm sao chép dữ liệu cũ hoặc chỉ thay đổi đơn giản! Bắt buộc duyệt qua toàn bộ danh sách quy tắc, dựa trên tương tác mới nhất để tính toán lại chuyên sâu cho từng biến số.)',
    '(Từ chối việc cực đoan hóa tính cách! Thiết lập chỉ là "thiên hướng" chứ không phải "tuyệt đối". Bắt buộc thể hiện những góc khuất của nhân vật, bộc lộ tự nhiên những khía cạnh mơ hồ và tinh tế của tính cách trong các tình huống hợp lý. Cấm đảo ngược khiên cưỡng, phá vỡ tư duy trắng đen rõ ràng, đào sâu vào bản chất thực sự của nhân tính phức tạp.)',
  ];

  // [Sửa lỗi cốt lõi]: Sử dụng ghép chuỗi và đối tượng RegExp an toàn để ngăn chặn triệt để trình render Markdown hoặc HTML nuốt mất thẻ comment
  const TAG_START = '<' + '!--';
  const TAG_END = '--' + '>';
  const SYS_NOTE_START = TAG_START + '[System Note]\n';
  const VIS_START = TAG_START + 'AIA_VISIBLE_START' + TAG_END;
  const VIS_END = TAG_START + 'AIA_VISIBLE_END' + TAG_END;

  const AIA_STEALTH_BLOCK_REGEX = new RegExp('\\n*<' + '!--\\s*\\[System Note\\][\\s\\S]*?--' + '>', 'g');
  const AIA_VISIBLE_BLOCK_REGEX = new RegExp('\\n*<' + '!--AIA_VISIBLE_START--' + '>[\\s\\S]*?<' + '!--AIA_VISIBLE_END--' + '>', 'g');
  const AIA_LEGACY_DIV_REGEX = new RegExp('\\n*<div class="aia-(stealth|visible)-cmd">\\[System Note:[\\s\\S]*?<\\/div>', 'g');
  const AIA_LEGACY_TAG_REGEX = new RegExp('\\n*<aia-cmd[\\s\\S]*?<\\/aia-cmd>', 'g');

  const state = {
    initialized: false,
    uiMounted: false,
    uiMounting: false,
    interceptBound: false,
    lastCharacterKey: '',
    lastAppendAt: 0,
  };

  function getContext() { return window.SillyTavern?.getContext?.() || null; }
  function isContextReady() {
    const ctx = getContext();
    return !!(ctx?.extensionSettings && typeof ctx.extensionSettings === 'object');
  }

  // Cốt lõi: Lấy và tự động sửa chữa cấu trúc dữ liệu
  function getStore() {
    const ctx = getContext();
    if (!ctx || !ctx.extensionSettings) return null;
  
    if (!ctx.extensionSettings[EXT_KEY] || typeof ctx.extensionSettings[EXT_KEY] !== 'object') {
      ctx.extensionSettings[EXT_KEY] = { instructions: [], stealthMode: false, seededDefaults: false };
    }
    const store = ctx.extensionSettings[EXT_KEY];

    // Làm phẳng (flatten) dữ liệu preset phiên bản cũ
    if (store.presets) {
      const flat = [];
      for (const [presetName, pData] of Object.entries(store.presets)) {
        for (const inst of (pData.instructions || [])) {
          if (!flat.find(x => x.text === inst.text)) {
            flat.push({
              id: inst.id || `aia_${Date.now()}_${Math.random()}`,
              text: inst.text,
              enabled: inst.enabled !== false,
              isDefault: (presetName === store.defaultPreset),
              boundChars: []
            });
          }
        }
      }
      store.instructions = flat;
      store.stealthMode = store.presets["默认预设"]?.stealthMode || false;
      delete store.presets;
      delete store.activePreset;
      delete store.defaultPreset;
      delete store.characterBindings;
      ctx.saveSettingsDebounced();
    }

    // Bổ sung các trường dữ liệu còn thiếu và xử lý tính tương thích khi nâng cấp từ phiên bản cũ
    if (Array.isArray(store.instructions)) {
      store.instructions.forEach(inst => {
        // Xác định xem có phải là dữ liệu được nâng cấp từ phiên bản cũ lên hay không:
        // 1. Không có trường boundChars (hoàn toàn chưa từng dùng phiên bản mới)
        // 2. Hoặc danh sách mắt xích trống, và lệnh này chưa từng được đánh dấu trạng thái "Dấu sao" một cách rõ ràng
        const isLegacy = inst.boundChars === undefined;
        const noChains = !inst.boundChars || inst.boundChars.length === 0;

        if (isLegacy || (noChains && inst.isDefault === undefined)) {
          // Logic tương thích cốt lõi: Để tránh việc lệnh bị vô hiệu hóa sau khi cập nhật, mặc định thiết lập các lệnh cũ thành "Dấu sao" (mặc định toàn cục)
          // Trừ khi lệnh này đã có mắt xích liên kết
          inst.isDefault = true;
        }

        // Khởi tạo dự phòng (fallback) cho các trường cơ bản
        if (inst.enabled === undefined) inst.enabled = true;
        if (inst.isDefault === undefined) inst.isDefault = false;
        if (!Array.isArray(inst.boundChars)) inst.boundChars = [];
      });
    }

    return store;
  }

  function getList() { return getStore()?.instructions || []; }
  
  function saveList(list) {
    const store = getStore();
    if (!store) return;
    store.instructions = list;
    getContext().saveSettingsDebounced();
  }

  function ensureDefaultInstructions() {
    const store = getStore();
    if (!store || store.seededDefaults) return;
    if (store.instructions.length > 0) {
      store.seededDefaults = true;
      getContext().saveSettingsDebounced();
      return;
    }
    store.instructions = DEFAULT_INSTRUCTIONS.map((text, index) => ({
      id: `aia_default_${index + 1}`,
      text,
      enabled: true,    
      isDefault: true,  
      boundChars: []
    }));
    store.seededDefaults = true;
    getContext().saveSettingsDebounced();
  }

  function getCurrentCharacterContext() {
    const ctx = getContext();
    if (!ctx) return { key: "" };

    let targetId = "";

    // 1. API gốc của SillyTavern bản mới nhất: Bắt chính xác chat đơn hoặc chat nhóm
    if (ctx.characterId !== undefined && ctx.characterId !== null) {
      targetId = ctx.characterId;
    } else if (ctx.groupId !== undefined && ctx.groupId !== null) {
      targetId = `group_${ctx.groupId}`;
    } 
    // 2. Dự phòng (fallback) bằng biến toàn cục của phiên bản cũ
    else if (typeof window.this_chid !== 'undefined' && window.this_chid !== null) {
      targetId = window.this_chid;
    } 
    // 3. Dự phòng (fallback) bằng metadata của đoạn chat (Dựa theo tên file/tên ảnh đại diện)
    else if (ctx.chat_metadata) {
      targetId = ctx.chat_metadata.character_id || ctx.chat_metadata.avatar || "";
    }

    targetId = String(targetId).trim();
    return targetId ? { key: `chid:${targetId}` } : { key: "" };
  }

  // Phán đoán xem một lệnh nào đó có hiệu lực trong đoạn chat hiện tại hay không: Công tắc tổng bật && (Dấu sao toàn cục || Mắt xích đã liên kết)
  function isInstructionActive(item) {
    if (!item.enabled) return false; 
    const charCtx = getCurrentCharacterContext();
    return item.isDefault || (charCtx.key && item.boundChars.includes(charCtx.key));
  }

  function getEnabledInstructionText() {
    return getList()
      .filter(item => isInstructionActive(item) && item.text.trim())
      .map(item => item.text.trim())
      .join('\n');
  }

  // Cốt lõi: Tiêm (inject) lệnh vào ô nhập liệu
  function appendInstructionsToInput() {
    const now = Date.now();
    if (now - state.lastAppendAt < 100) return;

    const $input = $('#send_textarea');
    if (!$input.length) return;

    const userText = String($input.val() || '').trimEnd();
    if (!userText) return;

    const enabledText = getEnabledInstructionText();
    if (!enabledText) return;

    scrubOldInstructions();

    let appendedText = '';
    if (getStore().stealthMode) {
      // Chế độ tàng hình: Ghép nối HTML comment một cách an toàn
      appendedText = ` ${SYS_NOTE_START}${enabledText}${TAG_END}`;
    } else {
      // Chế độ hiển thị: Ghép nối thẻ đánh dấu khối một cách an toàn
      const formattedText = enabledText.split('\n').join('\n> ');
      appendedText = `\n\n${VIS_START}\n> **[System Note]**\n> ${formattedText}\n${VIS_END}`;
    }

    $input.val(`${userText}${appendedText}`).trigger('input');
    state.lastAppendAt = now;
  }

  // Cốt lõi: Dọn dẹp các lệnh cũ trong lịch sử
  function scrubOldInstructions() {
    const ctx = getContext();
    if (!Array.isArray(ctx?.chat)) return;

    let didScrub = false;
    for (const message of ctx.chat) {
      if (!message || message.is_user !== true || typeof message.mes !== 'string') continue;
      
      const nextMes = message.mes
        .replace(AIA_STEALTH_BLOCK_REGEX, '')
        .replace(AIA_VISIBLE_BLOCK_REGEX, '')
        .replace(AIA_LEGACY_DIV_REGEX, '')
        .replace(AIA_LEGACY_TAG_REGEX, '');
        
      if (nextMes !== message.mes) {
        message.mes = nextMes;
        didScrub = true;
      }
    }
    
    if (didScrub) {
      window.saveChatDebounced?.();
      $('#chat .aia-stealth-cmd, #chat .aia-visible-cmd, #chat aia-cmd').remove();
    }
  }

  function bindSendInterception() {
    if (state.interceptBound) return;
    document.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('#send_but')) appendInstructionsToInput();
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        if (event.target instanceof HTMLElement && event.target.id === 'send_textarea') {
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent) || window.innerWidth <= 800;
          if (!isMobile) appendInstructionsToInput();
        }
      }
    }, true);
    state.interceptBound = true;
  }

  // --- Xây dựng UI ---
  function createInstructionItem(item) {
    const charCtx = getCurrentCharacterContext();
    const charKey = charCtx.key;
    const isBound = charKey && item.boundChars.includes(charKey);

    const $item = $('<div>').addClass('aia-item');
    
    // Bên trái: Công tắc tổng
    const $status = $('<div>').addClass('aia-item-status');
    const $checkbox = $('<input type="checkbox">')
      .prop('checked', item.enabled)
      .css({ cursor: 'pointer', margin: 0, width: '16px', height: '16px' })
      .attr('title', item.enabled ? 'Đã bật' : 'Đã tắt')
      .on('change', () => {
        item.enabled = !item.enabled;
        saveList(getList());
        renderInstructionList();
      });
    $status.append($checkbox);

    // Ở giữa: Văn bản (Sẽ tối đi nếu bị tắt)
    const $text = $('<div>')
      .addClass('aia-item-text')
      .text(item.text)
      .attr('title', item.text)
      .css('opacity', item.enabled ? '1' : '0.4');

    const $actions = $('<div>').addClass('aia-item-actions');

    // Bên phải 1: Dấu sao (Mặc định toàn cục)
    const $star = $('<i>')
      .addClass(`fa-star aia-item-icon ${item.isDefault ? 'fa-solid' : 'fa-regular'}`)
      .css('color', item.isDefault ? '#ffeb3b' : '')
      .css('opacity', item.enabled ? '' : '0.3')
      .attr('title', item.isDefault ? 'Mặc định toàn cục (Nhấp để hủy)' : 'Thiết lập làm mặc định toàn cục')
      .on('click', () => {
        item.isDefault = !item.isDefault;
        saveList(getList());
        renderInstructionList();
      });

    // Bên phải 2: Mắt xích (Liên kết với nhân vật hiện tại)
    const $link = $('<i>')
      .addClass(`aia-item-icon ${isBound ? 'fa-solid fa-link' : 'fa-solid fa-link-slash'}`)
      .css('color', isBound ? '#4caf50' : '')
      .css('opacity', item.enabled ? '' : '0.3')
      .attr('title', isBound ? 'Đã liên kết nhân vật này (Nhấp để hủy liên kết)' : 'Liên kết với nhân vật này')
      .on('click', () => {
        if (!charKey) return window.toastr?.warning?.('Không phát hiện thấy nhân vật, không thể liên kết');
        if (isBound) item.boundChars = item.boundChars.filter(k => k !== charKey);
        else item.boundChars.push(charKey);
        saveList(getList());
        renderInstructionList();
      });

    // Bên phải 3 & 4: Chỉnh sửa và Xóa
    const $editWrap = $('<div class="aia-edit-wrap"></div>');
    const $editInput = $('<textarea class="text_pole aia-edit-input"></textarea>').val(item.text);
    const $btnGroup = $('<div class="aia-edit-btns"></div>');
    const $saveBtn = $('<button class="menu_button aia-btn">Lưu</button>');
    const $cancelBtn = $('<button class="menu_button aia-btn">Hủy</button>');

    const $editIcon = $('<i>').addClass('fa-solid fa-pen aia-item-icon').attr('title', 'Chỉnh sửa')
      .on('click', () => {
        $text.hide(); $actions.hide();
        $editWrap.css('display', 'flex');
        $editInput.focus();
      });

    const $removeIcon = $('<i>').addClass('fa-solid fa-trash aia-item-icon').attr('title', 'Xóa')
      .on('click', () => {
        saveList(getList().filter(x => x.id !== item.id));
        renderInstructionList();
      });

    $saveBtn.on('click', () => {
      const clean = String($editInput.val() || '').trim();
      if (!clean) return window.toastr?.warning?.('Nội dung không được để trống');
      item.text = clean;
      saveList(getList());
      renderInstructionList();
    });

    $cancelBtn.on('click', () => {
      $editInput.val(item.text);
      $editWrap.hide();
      $text.show(); $actions.show();
    });

    $btnGroup.append($cancelBtn, $saveBtn);
    $editWrap.append($editInput, $btnGroup);
    $actions.append($star, $link, $editIcon, $removeIcon);
    return $item.append($status, $text, $editWrap, $actions);
  }

  function renderInstructionList() {
    const $list = $('#aia-list-wrap');
    if (!$list.length) return;
    $list.empty();
    const items = getList();
    if (!items.length) {
      $list.append($('<div class="aia-empty-tip">Hiện chưa có lệnh nào, vui lòng thêm ở phía trên</div>'));
      return;
    }
    items.forEach(item => $list.append(createInstructionItem(item)));
  }

  function openModal() {
    $('#aia-modal-overlay').show();
    $('#aia-modal').css('display', 'flex');
    renderInstructionList();
    $('#aia-new-instruction').focus();
  }

  function closeModal() {
    $('#aia-modal, #aia-modal-overlay').hide();
  }

  function resolveAssetUrl(fileName) {
  const script = Array.from(document.querySelectorAll('script[src]'))
    // Sử dụng Regex để khớp mờ: Bỏ qua phân biệt hoa thường, cho phép bất kỳ thư mục nào bắt đầu bằng "auto-instruction" hoặc "autoinstruction"
    .find(node => /\/auto-?instruction.*\/index\.js$/i.test(node.src));
    
  return script?.src ? new URL(fileName, script.src).toString() : fileName;
  }
  
  async function mountUI() {
    if (state.uiMounted || state.uiMounting || !$('#extensionsMenu').length) return;
    state.uiMounting = true;
    try {
      if (!$('#aia-modal').length) {
        // Trong hàm mountUI, thay thế đoạn code lấy url và fetch trước đây bằng:
        const res = await fetch(resolveAssetUrl('index.html'));
        $('body').append($(await res.text()).filter('#aia-modal-overlay, #aia-modal'));
      }
      if (!$('#aia-menu-btn').length) {
        const btn = '<div id="aia-menu-btn" class="list-group-item flex-container flexGap5 interactable"><i class="fa-solid fa-terminal"></i><span>Lệnh tự động</span></div>';
        $('#st_ext_manage_button').length ? $('#st_ext_manage_button').before(btn) : $('#extensionsMenu').append(btn);
      }
      $('#aia-menu-btn').off('click').on('click', openModal);
      $('#aia-modal-close, #aia-modal-overlay').off('click').on('click', closeModal);
      $('#aia-add-btn').off('click').on('click', () => {
        const val = $('#aia-new-instruction').val().trim();
        if (!val) return;
        const list = getList();
        list.push({ id: `aia_${Date.now()}`, text: val, enabled: true, isDefault: true, boundChars: [] });
        saveList(list);
        $('#aia-new-instruction').val('').focus();
        renderInstructionList();
      });
      $('#aia-new-instruction').off('keydown').on('keydown', (e) => { if (e.key === 'Enter') $('#aia-add-btn').click(); });
      
      const store = getStore();
      $('#aia-stealth-mode').prop('checked', store.stealthMode).off('change').on('change', function() {
        store.stealthMode = $(this).is(':checked');
        getContext().saveSettingsDebounced();
      });

      $(document).off('keydown.aiaEscape').on('keydown.aiaEscape', (e) => {
        if (e.key === 'Escape' && $('#aia-modal').is(':visible')) closeModal();
      });
      state.uiMounted = true;
    } finally {
      state.uiMounting = false;
    }
  }

  function initPlugin() {
    if (state.initialized || !isContextReady()) return;
    getStore();
    ensureDefaultInstructions();
    bindSendInterception();
    
    window.setInterval(() => {
      if (!$('#extensionsMenu').length) return;
      mountUI();
    }, 300);


    // Kiểm tra chuyển đổi nhân vật mỗi giây, và tự động thực thi logic chọn/bỏ chọn lệnh
    window.setInterval(() => {
      const curKey = getCurrentCharacterContext().key;
      if (curKey !== state.lastCharacterKey) {
        state.lastCharacterKey = curKey;
        
        const list = getList();
        let stateChanged = false;

        list.forEach(item => {
          // Quy tắc 3: Lệnh được chọn mặc định (Dấu sao) không bị ảnh hưởng bởi việc chuyển đổi, công tắc hoàn toàn do người dùng điều khiển thủ công
          if (item.isDefault) return;

          // Kiểm tra xem lệnh này có liên kết với nhân vật mới vừa được chuyển sang hay không
          const isBoundToCurrent = curKey && item.boundChars.includes(curKey);

          if (isBoundToCurrent && !item.enabled) {
            // Quy tắc 2: Vào đoạn chat của nhân vật đã liên kết, tự động chọn bật
            item.enabled = true;
            stateChanged = true;
          } else if (!isBoundToCurrent && item.enabled) {
            // Quy tắc 1: Thoát khỏi đoạn chat của nhân vật đã liên kết (Vào nhân vật chưa liên kết), tự động bỏ chọn tắt
            item.enabled = false;
            stateChanged = true;
          }
        });

        // Nếu trạng thái có tự động thay đổi, tiến hành lưu và làm mới giao diện
        if (stateChanged) {
          saveList(list);
        }
        if ($('#aia-modal').is(':visible')) renderInstructionList();
      }
    }, 1000);
    
    state.initialized = true;
  }

  if (window.eventSource && window.event_types?.APP_READY) {
    window.eventSource.on(window.event_types.APP_READY, initPlugin);
  }
  window.setInterval(() => { if (!state.initialized && isContextReady()) initPlugin(); }, 300);
})();