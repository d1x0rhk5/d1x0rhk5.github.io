$(document).ready(function() {
    $('#markdown-toc').addClass('toc-list');

    var $filters = $('[data-post-filter]');
    if (!$filters.length) {
        return;
    }

    $filters.each(function() {
        var $filter = $(this);
        var $buttons = $filter.find('[data-category]');
        var $posts = $('.post-list-item[data-category]');

        if (!$buttons.length || !$posts.length) {
            return;
        }

        $buttons.on('click', function() {
            var category = $(this).data('category');

            $buttons.removeClass('is-active');
            $(this).addClass('is-active');

            $posts.each(function() {
                var matches = category === 'all' || $(this).data('category') === category;
                $(this).toggle(matches);
            });
        });
    });
});
