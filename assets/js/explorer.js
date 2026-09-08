/**
 * Lógica da interface de busca de cartas (página inicial e Explorar).
 * Depende do cliente `window.PokemonTCG` (assets/js/pokemon-api.js).
 */
(function () {
    "use strict";

    const api = window.PokemonTCG;

    const STORAGE_KEYS = {
        favorites: "tcg_explorer_favorites",
        wishlist: "tcg_explorer_wishlist",
        collection: "tcg_explorer_collection"
    };

    const PAGE_SIZE = 48;
    const PAGE_SIZE_LIMIT = 100;

    const IMAGE_FALLBACK_SIZE = 245;

    const AUTO_LOAD_DELAY_MS = 500;

    const state = {
        hasSearched: false,
        isLoading: false,
        query: "",
        cards: [],
        totalCount: 0,
        selectedId: null,
        view: "grid",
        _currentPage: 1
    };

    const els = {};

    /* ================= Utilidades ================= */

    function h(tag, className, text) {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text !== undefined && text !== null) {
            element.textContent = text;
        }
        return element;
    }

    /* Imagem de reserva caso a foto da carta não carregue (ex.: CDN bloqueada). */

    const SIZE = IMAGE_FALLBACK_SIZE;

    const IMAGE_FALLBACK = (function () {
        const size = SIZE;
        const half = Math.round(SIZE / 2);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
            '<rect width="' + size + '" height="' + size + '" rx="12" fill="#2a2a33"/>' +
            '<circle cx="122" cy="160" r="52" fill="none" stroke="#4a4a55" stroke-width="10"/>' +
            '<path d="M122 108a52 52 0 0 1 0 104" fill="#4a4a55"/>' +
            '<rect x="122" y="152" width="70" height="16" rx="8" fill="#4a4a55"/>' +
            '<text x="122" y="300" font-family="Arial" font-size="16" fill="#6a6a75" text-anchor="middle">imagem indisponível</text></svg>';
        try {
            return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
        } catch (error) {
            return "";
        }
    })();

    function setImage(img, src) {
        const validSrc = src && src.trim() ? src.trim() : null;
        
        img.onerror = function () {
            img.onerror = null;
            img.src = IMAGE_FALLBACK;
            img.setAttribute("data-loaded", "true");
        };
        img.onload = function () {
            img.setAttribute("data-loaded", "true");
        };
        
        if (validSrc) {
            img.src = validSrc;
        } else {
            img.src = IMAGE_FALLBACK;
            img.setAttribute("data-loaded", "true");
        }
    }


    function readStore(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : {};
        } catch (error) {
            return {};
        }
    }

    function writeStore(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            /* armazenamento indisponível */
        }
    }

    function hasIn(key, id) {
        return Boolean(readStore(key)[id]);
    }

    function toggleIn(key, id) {
        const data = readStore(key);
        if (data[id]) {
            delete data[id];
        } else {
            data[id] = true;
        }
        writeStore(key, data);
        return Boolean(data[id]);
    }

    const STAGE_LABELS = {
        "Basic": "Básico",
        "Stage 1": "Estágio 1",
        "Stage 2": "Estágio 2",
        "BREAK": "BREAK",
        "Level Up": "Nível Máximo"
    };

    function stageLabel(card) {
        const subtypes = card.subtypes || [];
        for (let i = 0; i < subtypes.length; i++) {
            if (STAGE_LABELS[subtypes[i]]) {
                return STAGE_LABELS[subtypes[i]];
            }
        }
        return subtypes.length ? subtypes.join(", ") : "—";
    }

    function rarityClass(rarity) {
        const value = String(rarity || "").toLowerCase();
        if (value.indexOf("illustration") > -1) {
            return "rarity-illustration";
        }
        if (value.indexOf("secret") > -1 || value.indexOf("ultra") > -1 || value.indexOf("rainbow") > -1) {
            return "rarity-ultra";
        }
        if (value.indexOf("holo") > -1 || value.indexOf("ex") > -1 || value.indexOf("gx") > -1 ||
            value.indexOf(" v") > -1 || value.indexOf("vmax") > -1 || value.indexOf("vstar") > -1) {
            return "rarity-holo";
        }
        if (value.indexOf("rare") > -1) {
            return "rarity-rare";
        }
        if (value.indexOf("uncommon") > -1) {
            return "rarity-uncommon";
        }
        return "rarity-common";
    }

    function rarityPill(rarity) {
        return h("span", "rarity-pill " + rarityClass(rarity), rarity || "—");
    }

    function energySpan(type) {
        const span = h("span", "energy", api.typeLabel(type).charAt(0));
        span.style.backgroundColor = api.energyColor(type);
        span.title = api.typeLabel(type);
        return span;
    }

    function typesNode(types) {
        const wrap = h("span", "types-wrap");
        (types || []).forEach(function (type) {
            wrap.appendChild(energySpan(type));
            wrap.appendChild(h("span", "type-label", api.typeLabel(type)));
        });
        if (!wrap.firstChild) {
            wrap.textContent = "—";
        }
        return wrap;
    }

    function cardPrice(card) {
        const prices = api.getCardPrices(card);
        if (prices.tcgplayer !== null) {
            return { value: prices.tcgplayer, currency: "USD" };
        }
        if (prices.cardmarket !== null) {
            return { value: prices.cardmarket, currency: "EUR" };
        }
        return null;
    }

    function pokedexUrl(card) {
        const slug = String(card.name || "")
            .toLowerCase()
            .replace(/\s*(ex|gx|vmax|vstar|max|v-union|lv\.?\s*x|break|π|★)\s*$/i, "")
            .replace(/'/g, "")
            .replace(/[.]/g, "-")
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
        return "https://www.pokemon.com/br/pokedex/" + slug;
    }

    function releaseDate(card) {
        return String((card.set && card.set.releaseDate) || "");
    }

    function cardNumber(card) {
        const parsed = parseInt(card.number, 10);
        return isNaN(parsed) ? 0 : parsed;
    }

    function sortCards(cards, mode) {
        const list = cards.slice();
        const priceValue = function (card) {
            const price = cardPrice(card);
            return price ? price.value : -1;
        };

        switch (mode) {
            case "oldest":
                return list.sort(function (a, b) {
                    return releaseDate(a).localeCompare(releaseDate(b)) || cardNumber(a) - cardNumber(b);
                });
            case "name":
                return list.sort(function (a, b) {
                    return String(a.name).localeCompare(String(b.name), "pt-BR");
                });
            case "price-desc":
                return list.sort(function (a, b) {
                    return priceValue(b) - priceValue(a);
                });
            case "price-asc":
                return list.sort(function (a, b) {
                    return priceValue(a) - priceValue(b);
                });
            case "recent":
            default:
                return list.sort(function (a, b) {
                    return releaseDate(b).localeCompare(releaseDate(a)) || cardNumber(b) - cardNumber(a);
                });
        }
    }

    /* ================= Estados da área de resultados ================= */

    function setLoading(isLoading) {
        state.isLoading = isLoading;
        if (isLoading) {
            state.autoLoadTimer = null;
            if (state.cards.length) {
                state._pendingCards = state.cards.slice();
                state.cards = [];
                renderCurrentView();
            }
            els.stateBox.className = "state-box";
            els.stateBox.innerHTML = "";
            const spinner = h("div", "spinner");
            spinner.setAttribute("role", "status");
            els.stateBox.append(spinner, h("p", null, "Buscando cartas..."));
            els.stateBox.hidden = false;
            els.grid.hidden = true;
            els.list.hidden = true;
            if (els.moreBtn) {
                els.moreBtn.hidden = true;
                els.moreBtn.disabled = true;
            }
            updateCountLine();
            return;
        }

        els.stateBox.className = "state-box";
        els.stateBox.innerHTML = "";
        els.stateBox.hidden = true;
        els.grid.hidden = false;
        els.list.hidden = false;
        if (state._pendingCards && state._pendingCards.length) {
            state.cards = state._pendingCards.slice();
            state._pendingCards = null;
        }
        renderCurrentView();
        updateCountLine();
        if (state.cards.length) {
            selectCard(state.cards[0].id);
        }
    }

    function showEmptyInitial() {
        els.stateBox.className = "state-box";
        els.stateBox.innerHTML = "";
        els.stateBox.append(
            h("div", "pokeball-placeholder"),
            h("h3", null, "Encontre suas cartas favoritas"),
            h("p", null, "Digite o nome de uma carta e clique em Buscar, ou use um dos exemplos acima. Você verá foto, preços e detalhes de cada carta.")
        );
        els.stateBox.hidden = false;
        els.grid.hidden = true;
        els.list.hidden = true;
        updateCountLine();
    }

    function showNoResults() {
        els.stateBox.className = "state-box";
        els.stateBox.innerHTML = "";
        els.stateBox.append(
            h("div", "pokeball-placeholder"),
            h("h3", null, "Nenhuma carta encontrada"),
            h("p", null, state.query
                ? "Nenhum resultado para \"" + state.query + "\". Tente outro nome ou remova os filtros."
                : "Nenhum resultado para os filtros selecionados. Tente novamente.")
        );
        els.stateBox.hidden = false;
        els.grid.hidden = true;
        els.list.hidden = true;
        if (els.moreBtn) {
            els.moreBtn.hidden = true;
        }
        state.autoLoadTimer = null;
        updateCountLine();
    }

    function showError(message) {
        els.stateBox.className = "state-box state-error";
        els.stateBox.innerHTML = "";
        els.stateBox.append(
            h("h3", null, "Não foi possível concluir a busca"),
            h("p", null, message || "Ocorreu um erro inesperado. Tente novamente.")
        );
        els.stateBox.hidden = false;
        els.grid.hidden = true;
        els.list.hidden = true;
        if (els.moreBtn) {
            els.moreBtn.hidden = true;
        }
        state.autoLoadTimer = null;
        updateCountLine();
    }

    function selectValue(select) {
        return select ? String(select.value || "") : "";
    }

    function updateCountLine() {
        if (els.resultsHeader) {
            els.resultsHeader.hidden = !state.hasSearched;
        }
        if (!els.count) {
            return;
        }
        if (!state.hasSearched) {
            els.count.textContent = "";
            return;
        }
        const loaded = state.cards.length;
        let text = loaded + (loaded === 1 ? " carta" : " cartas");
        if (state.totalCount > loaded) {
            text += " (de " + state.totalCount + " no total)";
        }
        els.count.textContent = text;
        if (els.moreBtn) {
            els.moreBtn.hidden = state.totalCount <= loaded || state.isLoading;
        }
    }

    /* ================= Renderização das cartas ================= */

    function makeSelectable(element, card) {
        element.tabIndex = 0;
        element.setAttribute("role", "button");
        element.setAttribute("aria-pressed", String(card.id === state.selectedId));
        element.addEventListener("click", function () {
            selectCard(card.id);
        });
        element.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectCard(card.id);
            }
        });
    }

    function buildGridCard(card) {
        const item = h("article", "card-item" + (card.id === state.selectedId ? " selected" : ""));
        item.dataset.id = card.id;

        const image = h("img", "card-image");
        const imgSrc = (card.images && card.images.small) || "";
        image.alt = card.name;
        image.loading = "lazy";
        image.draggable = false;
        image.setAttribute("data-loaded", "false");
        
        if (imgSrc) {
            image.setAttribute("data-src", imgSrc);
            image.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        } else {
            image.src = IMAGE_FALLBACK;
            image.setAttribute("data-loaded", "true");
        }

        image.addEventListener("load", function () {
            image.setAttribute("data-loaded", "true");
        });
        image.addEventListener("error", function () {
            image.setAttribute("data-loaded", "true");
            if (image.src !== IMAGE_FALLBACK) {
                image.src = IMAGE_FALLBACK;
            }
        });

        item.append(
            image,
            h("h3", "card-name", card.name),
            h("p", "card-set", (card.set ? card.set.name + " • " : "") + card.number)
        );

        const meta = h("div", "card-meta");
        meta.appendChild(rarityPill(card.rarity));
        const price = cardPrice(card);
        if (price) {
            meta.appendChild(h("span", "card-price", api.formatPrice(price.value, price.currency)));
        }
        item.appendChild(meta);

        makeSelectable(item, card);
        return item;
    }

    function buildListRow(card) {
        const row = h("button", "card-row" + (card.id === state.selectedId ? " selected" : ""));
        row.type = "button";
        row.dataset.id = card.id;

        const image = h("img", "card-row-image");
        const imgSrc = (card.images && card.images.small) || "";
        image.alt = "";
        image.loading = "lazy";
        image.setAttribute("data-loaded", "false");
        
        if (imgSrc) {
            image.setAttribute("data-src", imgSrc);
            image.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        } else {
            image.src = IMAGE_FALLBACK;
            image.setAttribute("data-loaded", "true");
        }

        image.addEventListener("load", function () {
            image.setAttribute("data-loaded", "true");
        });
        image.addEventListener("error", function () {
            image.setAttribute("data-loaded", "true");
            if (image.src !== IMAGE_FALLBACK) {
                image.src = IMAGE_FALLBACK;
            }
        });

        const main = h("div", "card-row-main");
        main.append(
            h("span", "card-row-name", card.name),
            h("span", "card-row-set", (card.set ? card.set.name + " • " : "") + card.number)
        );

        row.append(image, main, rarityPill(card.rarity));

        const price = cardPrice(card);
        if (price) {
            row.appendChild(h("span", "card-price", api.formatPrice(price.value, price.currency)));
        }

        row.appendChild(h("span", "card-row-chevron", "›"));
        row.addEventListener("click", function () {
            selectCard(card.id);
        });
        return row;
    }

    function renderCards() {
        const container = state.view === "grid" ? els.grid : els.list;
        const builder = state.view === "grid" ? buildGridCard : buildListRow;
        container.innerHTML = "";
        state.cards.forEach(function (card) {
            container.appendChild(builder(card));
        });
        if (container.children.length) {
            // Carregar imagens visíveis imediatamente
            renderVisibleImages();
            scheduleAutoLoad();
        }
    }

    function renderCurrentView() {
        if (!state.hasSearched || state.isLoading || !state.cards.length) {
            return;
        }
        els.stateBox.hidden = true;
        els.grid.hidden = state.view !== "grid";
        els.list.hidden = state.view !== "list";
        renderCards();
        if (els.moreBtn) {
            els.moreBtn.hidden = state.totalCount <= state.cards.length || state.isLoading;
        }
    }

    function selectCard(cardId) {
        state.selectedId = cardId;

        document.querySelectorAll(".card-item, .card-row").forEach(function (element) {
            const isSelected = element.dataset.id === cardId;
            element.classList.toggle("selected", isSelected);
            if (element.getAttribute("role") === "button") {
                element.setAttribute("aria-pressed", String(isSelected));
            }
        });

        const card = state.cards.find(function (item) {
            return item.id === cardId;
        });
        if (card) {
            renderDetail(card);
            if (window.innerWidth <= 1100) {
                els.detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }
    }

    /* ================= Painel de detalhes ================= */

    const STAR_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    const HEART_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

    function iconButton(kind, isActive, title) {
        const button = h("button", "icon-btn");
        button.type = "button";
        button.title = title;
        button.setAttribute("aria-label", title);
        button.setAttribute("aria-pressed", String(Boolean(isActive)));
        button.innerHTML = kind === "star" ? STAR_SVG : HEART_SVG;
        if (isActive) {
            button.classList.add(kind === "star" ? "active-star" : "active-heart");
        }
        return button;
    }

    function priceRow(label, formattedValue) {
        const row = h("div", "price-row");
        row.appendChild(h("span", "price-label", label));
        row.appendChild(h("span", "price-value", formattedValue));
        return row;
    }

    function renderDetail(card) {
        els.detailEmpty.hidden = true;
        els.detailContent.hidden = false;
        els.detailContent.innerHTML = "";

        const imageWrap = h("div", "detail-image-wrap");
        const image = h("img", "detail-image");
        const detailSrc = (card.images && (card.images.large || card.images.small)) || "";
        image.alt = card.name;
        
        image.onerror = function () {
            image.onerror = null;
            image.src = IMAGE_FALLBACK;
        };
        
        if (detailSrc) {
            image.src = detailSrc;
        } else {
            image.src = IMAGE_FALLBACK;
        }
        imageWrap.appendChild(image);

        const titleRow = h("div", "detail-title-row");
        titleRow.appendChild(h("h3", "detail-name", card.name));

        const iconActions = h("div", "detail-icon-actions");

        const starButton = iconButton("star", hasIn(STORAGE_KEYS.favorites, card.id), "Favoritar carta");
        starButton.addEventListener("click", function () {
            const active = toggleIn(STORAGE_KEYS.favorites, card.id);
            starButton.classList.toggle("active-star", active);
            starButton.setAttribute("aria-pressed", String(active));
        });

        const heartButton = iconButton("heart", hasIn(STORAGE_KEYS.wishlist, card.id), "Adicionar à lista de desejos");
        heartButton.addEventListener("click", function () {
            const active = toggleIn(STORAGE_KEYS.wishlist, card.id);
            heartButton.classList.toggle("active-heart", active);
            heartButton.setAttribute("aria-pressed", String(active));
        });

        iconActions.append(starButton, heartButton);
        titleRow.appendChild(iconActions);

        const meta = h("div", "detail-meta");
        meta.appendChild(h("span", null, card.set
            ? card.set.name + " • " + card.number + "/" + (card.set.printedTotal || card.set.total || card.number)
            : card.number));
        meta.appendChild(rarityPill(card.rarity));

        const info = h("dl", "detail-info");
        const addInfo = function (label, value) {
            info.appendChild(h("dt", null, label));
            if (value instanceof Node) {
                const dd = h("dd");
                dd.appendChild(value);
                info.appendChild(dd);
            } else {
                info.appendChild(h("dd", null, (value === undefined || value === null || value === "") ? "—" : value));
            }
        };

        const isPokemon = card.supertype === "Pokémon";
        addInfo("Tipo", typesNode(card.types));
        addInfo("HP", isPokemon && card.hp ? String(card.hp) : "—");
        if (isPokemon) {
            addInfo("Estágio", stageLabel(card));
            addInfo("Evolui de", card.evolvesFrom || "—");
        }
        addInfo("Artista", card.artist || "—");
        addInfo("Raridade", card.rarity || "—");

        const attacksTitle = h("h4", "section-title", "Ataques");
        const attacksWrap = h("div", "attacks");

        if ((card.attacks || []).length) {
            card.attacks.forEach(function (attack) {
                const attackCard = h("div", "attack-card");
                const head = h("div", "attack-head");
                const nameWrap = h("div", "attack-name");

                (attack.cost || []).forEach(function (type) {
                    nameWrap.appendChild(energySpan(type));
                });
                nameWrap.appendChild(h("span", null, attack.name));

                head.appendChild(nameWrap);
                head.appendChild(h("span", "attack-damage", attack.damage || ""));
                attackCard.appendChild(head);
                if (attack.text) {
                    attackCard.appendChild(h("p", "attack-text", attack.text));
                }
                attacksWrap.appendChild(attackCard);
            });
        } else {
            attacksWrap.appendChild(h("p", "attack-text", "Esta carta não possui ataques registrados."));
        }

        const pricesTitle = h("h4", "section-title", "Preços de mercado");
        const pricesWrap = h("div", "prices");
        const prices = api.getCardPrices(card);

        if (prices.tcgplayer === null && prices.cardmarket === null) {
            pricesWrap.appendChild(h("p", "price-empty", "Nenhum preço disponível para esta carta no momento."));
        } else {
            if (prices.tcgplayer !== null) {
                const variantSuffix = prices.tcgplayerVariant ? " · " + api.variantLabel(prices.tcgplayerVariant) : "";
                pricesWrap.appendChild(priceRow("TCGplayer" + variantSuffix + " (USD)", api.formatPrice(prices.tcgplayer, "USD")));
            }
            if (prices.cardmarket !== null) {
                pricesWrap.appendChild(priceRow("Cardmarket · tendência (EUR)", api.formatPrice(prices.cardmarket, "EUR")));
            }
        }

        const actions = h("div", "detail-actions");

        const collectionButton = h("button", "btn btn-collection" + (hasIn(STORAGE_KEYS.collection, card.id) ? " in-collection" : ""));
        collectionButton.type = "button";
        collectionButton.textContent = hasIn(STORAGE_KEYS.collection, card.id) ? "✓ Na coleção" : "＋ Adicionar à coleção";
        collectionButton.setAttribute("aria-pressed", String(hasIn(STORAGE_KEYS.collection, card.id)));
        collectionButton.addEventListener("click", function () {
            const nowIn = toggleIn(STORAGE_KEYS.collection, card.id);
            collectionButton.classList.toggle("in-collection", nowIn);
            collectionButton.textContent = nowIn ? "✓ Na coleção" : "＋ Adicionar à coleção";
            collectionButton.setAttribute("aria-pressed", String(nowIn));
        });

        const pokedexLink = h("a", "btn btn-pokedex", "Ver no Pokédex");
        pokedexLink.href = pokedexUrl(card);
        pokedexLink.target = "_blank";
        pokedexLink.rel = "noopener noreferrer";

        actions.append(collectionButton, pokedexLink);

        els.detailContent.append(
            imageWrap,
            titleRow,
            meta,
            info,
            attacksTitle,
            attacksWrap,
            pricesTitle,
            pricesWrap,
            actions
        );
    }

    /* ================= Busca, filtros e eventos ================= */

    function updateKeyButton() {
        if (!els.key) {
            return;
        }
        const hasKey = Boolean(api.getJustTcgKey && api.getJustTcgKey());
        els.key.classList.toggle("active", hasKey);
        els.key.title = hasKey
            ? "Chave JustTCG configurada — clique para alterar ou remover"
            : "Configurar chave gratuita da JustTCG (preços em tempo real)";
    }

    function runSearch() {
        if (state.isLoading) {
            return;
        }

        state.query = els.input.value.trim();
        state.hasSearched = true;
        state.selectedId = null;
        state.autoLoadTimer = null;
        state._pendingCards = null;
        state._loadedCount = 0;

        // Limpar cards antes de setLoading para não salvar em _pendingCards
        state.cards = [];
        setLoading(true);
        updateCountLine();

        api.searchCards({
            name: state.query,
            type: selectValue(els.type),
            rarity: selectValue(els.rarity),
            setId: selectValue(els.set),
            pageSize: PAGE_SIZE,
            page: 1
        }).then(function (result) {
            state.isLoading = false;
            state._currentPage = 1;
            state.cards = sortCards(result.cards, selectValue(els.sort) || "recent");
            state.totalCount = result.totalCount;
            state.autoLoadTimer = null;
            state._loadedCount = state.cards.length;

            if (!state.cards.length) {
                showNoResults();
                updateCountLine();
                return;
            }

            setLoading(false);
            updateCountLine();
            selectCard(state.cards[0].id);
        }).catch(function (error) {
            state.isLoading = false;
            state._currentPage = 1;
            state.cards = [];
            state.totalCount = 0;
            state.autoLoadTimer = null;
            state._pendingCards = null;
            state._loadedCount = 0;
            showError(error && error.message ? error.message : "Ocorreu um erro inesperado. Tente novamente.");
            updateCountLine();
        });
    }

    function loadMoreCards() {
        if (state.isLoading || !state.hasSearched || !state.cards.length) {
            return;
        }
        const remaining = state.totalCount - state._loadedCount;
        if (remaining <= 0) {
            return;
        }
        const nextPage = state._currentPage + 1;
        const nextSize = Math.min(PAGE_SIZE_LIMIT, remaining);
        if (nextSize <= 0) {
            return;
        }
        state.isLoading = true;
        setLoading(true);
        updateCountLine();

        api.searchCards({
            name: state.query,
            type: selectValue(els.type),
            rarity: selectValue(els.rarity),
            setId: selectValue(els.set),
            pageSize: nextSize,
            page: nextPage
        }).then(function (result) {
            state.isLoading = false;
            state._currentPage = nextPage;
            const incoming = sortCards(result.cards, selectValue(els.sort) || "recent");
            state.cards = state.cards.concat(incoming);
            state._loadedCount += incoming.length;
            state.totalCount = result.totalCount;
            renderCurrentView();
            updateCountLine();
            if (incoming.length) {
                selectCard(incoming[0].id);
            }
        }).catch(function (error) {
            state.isLoading = false;
            showError(error && error.message ? error.message : "Ocorreu um erro inesperado. Tente novamente.");
            updateCountLine();
        });
    }

    function renderVisibleImages() {
        const container = state.view === "grid" ? els.grid : els.list;
        if (!container) {
            return;
        }
        const images = container.querySelectorAll("img.card-image, img.card-row-image");
        if (!images.length) {
            return;
        }
        const visible = [];
        const containerRect = container.getBoundingClientRect();
        const windowHeight = window.innerHeight || document.documentElement.clientHeight;
        const preloadOffset = windowHeight * 0.5;
        
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            if (img.getAttribute("data-loaded") === "true") {
                continue;
            }
            if (!img.getAttribute("data-src")) {
                continue;
            }
            const rect = img.getBoundingClientRect();
            if (rect.bottom >= containerRect.top - preloadOffset && rect.top <= containerRect.bottom + preloadOffset) {
                visible.push(img);
            }
        }
        if (visible.length) {
            visible.forEach(function (img) {
                const src = img.getAttribute("data-src");
                if (src) {
                    img.src = src;
                    img.removeAttribute("data-src");
                }
            });
        }
    }

    function scheduleAutoLoad() {
        if (state.autoLoadTimer) {
            return;
        }
        state.autoLoadTimer = setTimeout(function () {
            state.autoLoadTimer = null;
            renderVisibleImages();
            if (state.cards.length) {
                scheduleAutoLoad();
            }
        }, AUTO_LOAD_DELAY_MS);
    }

    function clearAll() {
        if (els.type) els.type.value = "";
        if (els.rarity) els.rarity.value = "";
        if (els.set) els.set.value = "";
        if (els.sort) els.sort.value = "recent";
        state.hasSearched = false;
        state.isLoading = false;
        state.cards = [];
        state.totalCount = 0;
        state.selectedId = null;
        state.autoLoadTimer = null;
        state._pendingCards = null;
        state._loadedCount = 0;
        state._currentPage = 1;
        if (els.detailContent) els.detailContent.hidden = true;
        if (els.detailEmpty) els.detailEmpty.hidden = false;
        showEmptyInitial();
    }

    function setView(view) {
        state.view = view;
        if (els.viewGrid) {
            els.viewGrid.classList.toggle("active", view === "grid");
            els.viewGrid.setAttribute("aria-pressed", String(view === "grid"));
        }
        if (els.viewList) {
            els.viewList.classList.toggle("active", view === "list");
            els.viewList.setAttribute("aria-pressed", String(view === "list"));
        }
        renderCurrentView();
    }

    function loadSets() {
        api.getSets().then(function (sets) {
            sets.forEach(function (set) {
                const option = document.createElement("option");
                option.value = set.id;
                option.textContent = set.name;
                els.set.appendChild(option);
            });
        }).catch(function () {
            /* Sem o filtro de sets a busca continua funcionando. */
        });
    }

    function cacheElements() {
        els.form = document.getElementById("search-form");
        els.input = document.getElementById("search-input");
        els.examples = document.getElementById("search-examples");
        els.type = document.getElementById("filter-type");
        els.rarity = document.getElementById("filter-rarity");
        els.set = document.getElementById("filter-set");
        els.sort = document.getElementById("filter-sort");
        els.clear = document.getElementById("clear-filters");
        els.key = document.getElementById("api-key-btn");
        els.resultsHeader = document.getElementById("results-header");
        els.count = document.getElementById("results-count");
        els.viewGrid = document.getElementById("view-grid");
        els.viewList = document.getElementById("view-list");
        els.moreBtn = document.getElementById("load-more-btn");
        els.stateBox = document.getElementById("results-state");
        els.grid = document.getElementById("cards-grid");
        els.list = document.getElementById("cards-list");
        els.detailPanel = document.getElementById("detail-panel");
        els.detailEmpty = document.getElementById("detail-empty");
        els.detailContent = document.getElementById("detail-content");

        return Boolean(els.form && els.input && els.examples && els.grid && els.list && els.detailPanel);
    }

    function bindEvents() {
        els.form.addEventListener("submit", function (event) {
            event.preventDefault();
            runSearch();
        });

        if (els.clear) {
            els.clear.addEventListener("click", clearAll);
        }

        if (els.key) {
            updateKeyButton();
            els.key.addEventListener("click", function () {
                const current = api.getJustTcgKey ? api.getJustTcgKey() : "";
                const value = window.prompt(
                    "Chave da API JustTCG (grátis em justtcg.com — 100 buscas/dia).\n" +
                    "Cole aqui para ter preços em tempo real, ou deixe vazio para remover:",
                    current
                );
                if (value === null) {
                    return;
                }
                if (api.saveJustTcgKey) {
                    api.saveJustTcgKey(value);
                }
                updateKeyButton();
                if (state.hasSearched) {
                    runSearch();
                }
            });
        }

        [els.type, els.rarity, els.set, els.sort].forEach(function (select) {
            if (!select) {
                return;
            }
            select.addEventListener("change", function () {
                if (state.hasSearched) {
                    runSearch();
                }
            });
        });

        if (els.viewGrid) {
            els.viewGrid.addEventListener("click", function () {
                setView("grid");
            });
        }

        if (els.viewList) {
            els.viewList.addEventListener("click", function () {
                setView("list");
            });
        }

        if (els.moreBtn) {
            els.moreBtn.addEventListener("click", loadMoreCards);
        }

        els.examples.querySelectorAll(".example-link").forEach(function (button) {
            button.addEventListener("click", function () {
                els.input.value = button.dataset.query || "";
                runSearch();
            });
        });
        
        // Carregar imagens visíveis ao rolar a página
        let scrollTimeout;
        window.addEventListener("scroll", function () {
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }
            scrollTimeout = setTimeout(function () {
                renderVisibleImages();
            }, 100);
        }, { passive: true });
    }

    function init() {
        if (!cacheElements()) {
            return;
        }
        if (!api) {
            console.error("Cliente da API Pokémon TCG não carregado (assets/js/pokemon-api.js).");
            return;
        }

        bindEvents();
        loadSets();

        // A busca começa vazia. Se a página for aberta com ?q=termo, buscamos automaticamente.
        const urlQuery = new URLSearchParams(window.location.search).get("q");
        if (urlQuery && urlQuery.trim()) {
            els.input.value = urlQuery.trim();
            runSearch();
        } else {
            showEmptyInitial();
        }

        window.addEventListener("scroll", scheduleAutoLoad, { passive: true });
        window.addEventListener("resize", scheduleAutoLoad, { passive: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();