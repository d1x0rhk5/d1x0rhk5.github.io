(function () {
    'use strict';

    function setupThemeToggle() {
        var toggle = document.querySelector('[data-theme-toggle]');
        if (!toggle) return;

        function updateLabel() {
            var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            toggle.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
            toggle.setAttribute('title', isDark ? 'Switch to light theme' : 'Switch to dark theme');
        }

        updateLabel();
        toggle.addEventListener('click', function () {
            var nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', nextTheme);
            try { localStorage.setItem('theme', nextTheme); } catch (error) {}
            updateLabel();
        });
    }

    function setupPostFilter() {
        document.querySelectorAll('[data-post-filter]').forEach(function (filter) {
            var buttons = filter.querySelectorAll('[data-category]');
            var posts = document.querySelectorAll('.post-list-item[data-category]');

            buttons.forEach(function (button) {
                button.addEventListener('click', function () {
                    var category = button.getAttribute('data-category');

                    buttons.forEach(function (item) {
                        var active = item === button;
                        item.classList.toggle('is-active', active);
                        item.setAttribute('aria-pressed', active ? 'true' : 'false');
                    });

                    posts.forEach(function (post) {
                        var matches = category === 'all' || post.getAttribute('data-category') === category;
                        post.hidden = !matches;
                    });
                });
            });
        });
    }

    function getCodeLanguage(code) {
        var languageContainer = code.closest('[class*="language-"], [class*="lang-"]');
        var classes = Array.prototype.slice.call(languageContainer ? languageContainer.classList : code.classList);
        var languageClass = classes.find(function (name) {
            return name.indexOf('language-') === 0 || name.indexOf('lang-') === 0;
        });

        if (!languageClass) return 'code';
        return languageClass.replace(/^language-|^lang-/, '');
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }

        return new Promise(function (resolve, reject) {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();

            var copied = document.execCommand('copy');
            textarea.remove();
            if (copied) resolve();
            else reject(new Error('Copy command failed'));
        });
    }

    function setupCodeBlocks() {
        document.querySelectorAll('.page-content pre').forEach(function (pre) {
            if (pre.parentElement && pre.parentElement.classList.contains('code-block')) return;

            var code = pre.querySelector('code');
            if (!code) return;

            var wrapper = document.createElement('div');
            var toolbar = document.createElement('div');
            var language = document.createElement('span');
            var copyButton = document.createElement('button');

            wrapper.className = 'code-block';
            toolbar.className = 'code-toolbar';
            language.className = 'code-language';
            language.textContent = getCodeLanguage(code);
            copyButton.className = 'copy-code';
            copyButton.type = 'button';
            copyButton.textContent = 'Copy';
            copyButton.setAttribute('aria-label', 'Copy code to clipboard');

            toolbar.appendChild(language);
            toolbar.appendChild(copyButton);
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(toolbar);
            wrapper.appendChild(pre);
            pre.setAttribute('tabindex', '0');

            copyButton.addEventListener('click', function () {
                copyText(code.textContent).then(function () {
                    copyButton.textContent = 'Copied';
                    window.setTimeout(function () { copyButton.textContent = 'Copy'; }, 1600);
                }).catch(function () {
                    var selection = window.getSelection();
                    var range = document.createRange();
                    range.selectNodeContents(code);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    copyButton.textContent = 'Selected';
                    window.setTimeout(function () { copyButton.textContent = 'Copy'; }, 1600);
                });
            });
        });
    }

    function setupContentMedia() {
        document.querySelectorAll('.page-content table').forEach(function (table) {
            if (table.parentElement && table.parentElement.classList.contains('table-scroll')) return;
            var wrapper = document.createElement('div');
            wrapper.className = 'table-scroll';
            table.parentNode.insertBefore(wrapper, table);
            wrapper.appendChild(table);
        });

        document.querySelectorAll('.page-content img').forEach(function (image) {
            image.loading = 'lazy';
            image.decoding = 'async';
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        var toc = document.getElementById('markdown-toc');
        if (toc) toc.classList.add('toc-list');
        setupThemeToggle();
        setupPostFilter();
        setupCodeBlocks();
        setupContentMedia();
    });
})();
