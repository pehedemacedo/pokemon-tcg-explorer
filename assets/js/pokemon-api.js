/**
 * Cliente de dados do Pokémon TCG com PROVEDORES EM CADEIA (fallback automático).
 *
 * Ordem de tentativa para BUSCAR CARTAS:
 *   1. JustTCG (https://justtcg.com) — preços em tempo real (USD).
 *      Chave grátis (100 buscas/dia): configure pelo botão 🔑 Chave API
 *      (fica no localStorage) ou cole em JUSTTCG_KEY abaixo.
 *   2. Índice estático (assets/data/card-index.json, gerado por
 *      tools/build-card-index.py) — sem chave, sem limite: busca por nome
 *      com preços de mercado diários e fotos na CDN da TCGplayer.
 *   3. pokemon-tcg-data (cdn.jsdelivr.net) — sem chave; busca por coleção
 *      selecionada (e base de dados usada pelo índice).
 *   4. pokemontcg.io v2 — sem chave (1.000 req/dia); usado quando a rede
 *      consegue alcançá-lo (em algumas redes ele está bloqueado).
 *
 * IMAGENS (ordem de tentativa por carta):
 *   1. CDN da TCGPlayer (product-images.tcgplayer.com/<tcgplayerId>.jpg)
 *   2. URL do próprio provedor (pokemontcg.io / pokemon-tcg-data), se houver
 *
 * DETALHES (HP, estágio, evolução, ataques, artista, número):
 *   Enriquecimento automático via pokemon-tcg-data no jsdelivr quando o
 *   provedor de busca não traz esses campos (caso do JustTCG).
 */
(function (global) {
    "use strict";

    /* ===================== Configuração ===================== */

    // Cole sua chave JustTCG aqui (grátis em https://justtcg.com).
    // Alternativa para testes: defina window.JUSTTCG_API_KEY antes de carregar este arquivo.
    const JUSTTCG_KEY = (typeof global.JUSTTCG_API_KEY === "string" && global.JUSTTCG_API_KEY)
        ? global.JUSTTCG_API_KEY
        : "";
    // Opcional: chave do pokemontcg.io (https://dev.pokemontcg.io).
    const POKEMONTCG_KEY = (typeof global.POKEMONTCG_API_KEY === "string" && global.POKEMONTCG_API_KEY)
        ? global.POKEMONTCG_API_KEY
        : "";

    /* Índice estático gerado por tools/build-card-index.py.
       O caminho é derivado da própria URL deste script, funcionando tanto na
       raiz (index.html) quanto em subpastas (pages/explorer.html). */
    const INDEX_URL = (function () {
        const scriptSrc = typeof document !== "undefined" && document.currentScript
            ? document.currentScript.src
            : "";
        if (scriptSrc) {
            return scriptSrc.replace(/js\/pokemon-api\.js(?:\?.*)?$/, "data/card-index.json");
        }
        return "assets/data/card-index.json";
    })();

    const JUSTTCG_BASE = "https://api.justtcg.com/v1";
    const DATA_BASE = "https://cdn.jsdelivr.net/gh/PokemonTCG/pokemon-tcg-data@master";
    const POKEMONTCG_BASE = "https://api.pokemontcg.io/v2";
    const TCGPLAYER_IMG = "https://product-images.tcgplayer.com";

    /* ===================== Traduções e cores ===================== */

    const TYPE_LABELS = {
        Grass: "Planta",
        Fire: "Fogo",
        Water: "Água",
        Lightning: "Elétrico",
        Fighting: "Lutador",
        Psychic: "Psíquico",
        Darkness: "Trevas",
        Metal: "Metal",
        Dragon: "Dragão",
        Fairy: "Fada",
        Colorless: "Incolor"
    };

    const ENERGY_COLORS = {
        Grass: "#5ec26a",
        Fire: "#ff7a45",
        Water: "#4aa8ff",
        Lightning: "#ffd166",
        Fighting: "#f97316",
        Psychic: "#b678f0",
        Darkness: "#7c7287",
        Metal: "#9aa7b5",
        Dragon: "#d4a24e",
        Fairy: "#f7a8c4",
        Colorless: "#c9c9d4"
    };

    const VARIANT_LABELS = {
        normal: "normal",
        holofoil: "holo",
        reverseHolofoil: "reverse holo",
        "1stEdition": "1ª edição",
        "1stEditionHolofoil": "1ª edição holo",
        unlimited: "ilimitada",
        limited: "limitada"
    };

    /* ===================== Helpers de rede ===================== */

    function timeoutSignal(ms) {
        if (typeof AbortController === "undefined") {
            return undefined;
        }
        const controller = new AbortController();
        setTimeout(function () {
            controller.abort();
        }, ms);
        return controller.signal;
    }

    async function fetchJson(url, options) {
        const opts = options || {};
        const response = await fetch(url, {
            headers: opts.headers || { Accept: "application/json" },
            signal: timeoutSignal(opts.timeout || 15000)
        });
        if (!response.ok) {
            const error = new Error("HTTP " + response.status);
            error.status = response.status;
            throw error;
        }
        return response.json();
    }

    function nameParts(name) {
        const clean = String(name || "").replace(/[*"]/g, "").trim();
        if (!clean) {
            return [];
        }
        return clean.toLowerCase().split(/\s+/).filter(Boolean);
    }

    /* ===================== Blobs das coleções (fallback aberto) ===================== */

    const setBlobPromises = {};

    function getSetBlob(setId) {
        if (!setBlobPromises[setId]) {
            setBlobPromises[setId] = fetchJson(DATA_BASE + "/cards/en/" + setId + ".json", { timeout: 20000 })
                .catch(function (error) {
                    delete setBlobPromises[setId]; // permite nova tentativa depois
                    throw error;
                });
        }
        return setBlobPromises[setId];
    }

    function readBlobCache() {
        try {
            return JSON.parse(localStorage.getItem("tcg_sets_cache") || "[]");
        } catch (error) {
            return [];
        }
    }

    function writeBlobCache(sets) {
        try {
            localStorage.setItem("tcg_sets_cache", JSON.stringify(sets));
            localStorage.setItem("tcg_sets_cache_date", String(Date.now()));
        } catch (error) {
            /* armazenamento indisponível */
        }
    }

    function blobMatches(blob, parts, filters) {
        const name = String(blob.name || "").toLowerCase();
        const hp = String(blob.hp || "");
        for (let i = 0; i < parts.length; i++) {
            if (name.indexOf(parts[i]) === -1) {
                return false;
            }
        }
        if (filters.type && !(blob.types || []).includes(filters.type)) {
            return false;
        }
        if (filters.rarity && String(blob.rarity || "") !== filters.rarity) {
            return false;
        }
        if (filters.setId && String((blob.set && blob.set.id) || "") !== filters.setId) {
            return false;
        }
        return true;
    }

    /* ===================== Imagens ===================== */

    function tcgplayerImage(productId, size) {
        const id = String(productId || "").trim();
        if (!id) {
            return "";
        }
        return TCGPLAYER_IMG + "/fit-in/" + (size === "small" ? "437x437" : "874x874") + "/" + id + ".jpg";
    }

    /* ===================== Provedor JustTCG ===================== */

    let justtcgSetsPromise = null;

    function storedJustTcgKey() {
        try {
            return localStorage.getItem("tcg_justtcg_key") || "";
        } catch (error) {
            return "";
        }
    }

    function activeKey() {
        return JUSTTCG_KEY || storedJustTcgKey();
    }

    function justtcgConfigured() {
        return Boolean(activeKey());
    }

    function justtcgHeaders() {
        return { Accept: "application/json", "x-api-key": activeKey() };
    }

    /** Salva a chave JustTCG no localStorage (string vazia remove). */
    function saveJustTcgKey(key) {
        try {
            const value = String(key || "").trim();
            if (value) {
                localStorage.setItem("tcg_justtcg_key", value);
            } else {
                localStorage.removeItem("tcg_justtcg_key");
            }
        } catch (error) {
            /* armazenamento indisponível */
        }
        return activeKey();
    }

    function getJustTcgKey() {
        return activeKey();
    }

    async function getJusttcgSets() {
        if (!justtcgSetsPromise) {
            justtcgSetsPromise = fetchJson(JUSTTCG_BASE + "/sets?game=pokemon", {
                headers: justtcgHeaders(),
                timeout: 15000
            }).then(function (body) {
                const list = Array.isArray(body) ? body : (body && body.data) || [];
                return list.map(function (item) {
                    return {
                        id: String(item.id || ""),
                        name: String(item.name || item.set_name || ""),
                        releaseDate: String(item.releaseDate || "")
                    };
                }).filter(function (item) {
                    return item.id && item.name;
                });
            }).catch(function () {
                return [];
            });
        }
        return justtcgSetsPromise;
    }

    function variantKeyFromPrinting(printing) {
        const value = String(printing || "").trim();
        const lower = value.toLowerCase();
        if (!value || lower === "normal") {
            return "normal";
        }
        if (lower.indexOf("reverse") > -1) {
            return "reverseHolofoil";
        }
        if (lower.indexOf("1st") > -1) {
            return lower.indexOf("holo") > -1 ? "1stEditionHolofoil" : "1stEdition";
        }
        if (lower.indexOf("holo") > -1) {
            return "holofoil";
        }
        if (lower === "unlimited") {
            return "unlimited";
        }
        if (lower === "limited") {
            return "limited";
        }
        const key = lower.replace(/[^a-z0-9]+/g, "");
        if (key && !VARIANT_LABELS[key]) {
            VARIANT_LABELS[key] = value; // rótulo legível para variantes desconhecidas
        }
        return key || "normal";
    }

    function conditionRank(condition) {
        const value = String(condition || "").toLowerCase();
        if (value.indexOf("near mint") > -1) return 0;
        if (value.indexOf("lightly played") > -1) return 1;
        if (value.indexOf("moderately played") > -1) return 2;
        if (value.indexOf("heavily played") > -1) return 3;
        if (value.indexOf("damaged") > -1) return 4;
        return 5;
    }

    function variantPrice(variant) {
        if (typeof variant.price === "number") {
            return variant.price;
        }
        if (variant.prices && typeof variant.prices.market === "number") {
            return variant.prices.market;
        }
        return null;
    }

    /** Agrupa variantes por impressão e guarda o melhor preço (Near Mint primeiro). */
    function justtcgPrices(card) {
        const prices = {};
        const variants = (Array.isArray(card.variants) ? card.variants : []).filter(function (variant) {
            const lang = String(variant.language || "").toLowerCase();
            return !lang || lang.indexOf("english") > -1;
        });
        variants.forEach(function (variant) {
            const price = variantPrice(variant);
            if (typeof price !== "number") {
                return;
            }
            const key = variantKeyFromPrinting(variant.variant || variant.printing);
            const current = prices[key];
            if (!current || conditionRank(variant.condition) < conditionRank(current._condition) ||
                (conditionRank(variant.condition) === conditionRank(current._condition) && price < current.market)) {
                prices[key] = { market: price, _condition: variant.condition };
            }
        });
        Object.keys(prices).forEach(function (key) {
            prices[key] = { market: prices[key].market };
        });
        return prices;
    }

    function normalizeJustTcgCard(card, index) {
        const rawId = card.id || card.tcgplayerId || String(index);
        const slugLike = /^[a-z0-9-]+$/;
        const setName = String(card.set_name || (typeof card.set === "string" && !slugLike.test(card.set) ? card.set : "") || "");
        return {
            id: "jtc-" + rawId,
            name: String(card.name || "").trim(),
            supertype: "Pokémon",
            subtypes: [],
            number: String(card.number || ""),
            rarity: String(card.rarity || "").trim(),
            images: {
                small: tcgplayerImage(card.tcgplayerId, "small"),
                large: tcgplayerImage(card.tcgplayerId, "large")
            },
            set: {
                id: typeof card.set === "string" ? card.set : "",
                name: setName,
                printedTotal: 0,
                releaseDate: ""
            },
            types: [],
            hp: "",
            attacks: [],
            tcgplayer: { prices: justtcgPrices(card) },
            _tcgplayerId: String(card.tcgplayerId || ""),
            _source: "justtcg"
        };
    }

    /* ===================== Dados abertos (pokemon-tcg-data via jsdelivr) ===================== */

    let dataSetsPromise = null;
    const candidateCache = {};

    async function getDataSets() {
        if (!dataSetsPromise) {
            const cached = readBlobCache();
            let cachedAt = 0;
            try {
                cachedAt = Number(localStorage.getItem("tcg_sets_cache_date") || 0);
            } catch (error) {
                cachedAt = 0;
            }
            if (cached.length && Date.now() - cachedAt < 7 * 86400000) {
                dataSetsPromise = Promise.resolve(cached);
            } else {
                dataSetsPromise = fetchJson(DATA_BASE + "/sets/en.json", { timeout: 20000 }).then(function (sets) {
                    if (Array.isArray(sets) && sets.length) {
                        writeBlobCache(sets);
                    }
                    return sets;
                }).catch(function (error) {
                    dataSetsPromise = null;
                    if (cached.length) {
                        return cached;
                    }
                    throw error;
                });
            }
        }
        return dataSetsPromise;
    }

    function normKey(value) {
        return String(value || "").toLowerCase()
            .replace(/[—–]/g, "-")
            .replace(/&/g, "and")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function parseDate(value) {
        const text = String(value || "").trim().replace(/\//g, "-");
        if (!text) {
            return null;
        }
        const time = Date.parse(text);
        return isNaN(time) ? null : time;
    }

    function datesClose(a, b) {
        const dateA = parseDate(a);
        const dateB = parseDate(b);
        if (dateA === null || dateB === null) {
            return false;
        }
        return Math.abs(dateA - dateB) <= 45 * 86400000;
    }

    function normNumber(value) {
        return String(value || "").toLowerCase().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
    }

    /** Encontra coleções do pokemon-tcg-data equivalentes à coleção de origem. */
    async function dataSetCandidates(sourceName, releaseDate) {
        const key = normKey(sourceName) + "|" + String(releaseDate || "");
        if (candidateCache[key]) {
            return candidateCache[key];
        }

        let sets = [];
        try {
            sets = await getDataSets();
        } catch (error) {
            candidateCache[key] = [];
            return [];
        }

        const target = normKey(sourceName);
        if (!target) {
            candidateCache[key] = [];
            return [];
        }

        const scored = [];
        sets.forEach(function (set) {
            const candidate = normKey(set.name);
            if (candidate.length < 3) {
                return;
            }
            let tier = 0;
            if (candidate === target) {
                tier = 3;
            } else if (target.indexOf(candidate) === 0 || candidate.indexOf(target) === 0) {
                tier = 2; // uma é prefixo da outra (ex.: "Base" e "Base Set")
            } else if (target.indexOf(candidate) > -1 || candidate.indexOf(target) > -1) {
                tier = 1; // apenas contidas (ex.: "151" ⊂ "Scarlet & Violet—151")
            }
            if (!tier) {
                return;
            }
            let score = tier * 100;
            if (datesClose(set.releaseDate, releaseDate)) {
                score += 50;
            }
            score += Math.min(candidate.length, 40);
            scored.push({ id: set.id, score: score });
        });

        scored.sort(function (a, b) {
            return b.score - a.score;
        });
        const ids = scored.slice(0, 4).map(function (item) {
            return item.id;
        });
        candidateCache[key] = ids;
        return ids;
    }

    function findDataCard(blob, card) {
        const number = normNumber(card.number);
        const name = normKey(card.name);
        let matches = blob.filter(function (item) {
            return Boolean(number) && normNumber(item.number) === number;
        });
        if (!matches.length) {
            matches = blob.filter(function (item) {
                return Boolean(name) && normKey(item.name) === name;
            });
        }
        if (!matches.length) {
            return null;
        }
        const byName = matches.find(function (item) {
            const itemName = normKey(item.name);
            return itemName === name || itemName.indexOf(name) > -1 || name.indexOf(itemName) > -1;
        });
        return byName || matches[0];
    }

    function mergeDataCard(card, data) {
        card.supertype = data.supertype || card.supertype || "Pokémon";
        card.subtypes = data.subtypes || [];
        if (data.hp) {
            card.hp = data.hp;
        }
        card.types = data.types || [];
        card.evolvesFrom = data.evolvesFrom || "";
        card.abilities = data.abilities || [];
        card.attacks = data.attacks || [];
        card.weaknesses = data.weaknesses || [];
        card.retreat = data.retreat;
        card.artist = data.artist || "";
        card.level = data.level || "";
        if (data.number) {
            card.number = data.number;
        }
        const dataSet = data.set || {};
        card.set = {
            id: dataSet.id || card.set.id,
            name: dataSet.name || card.set.name,
            printedTotal: dataSet.printedTotal || 0,
            total: dataSet.total,
            releaseDate: dataSet.releaseDate || "",
            series: dataSet.series || ""
        };
        if (!card.images.small && data.images && (data.images.small || data.images.large)) {
            card.images = { small: data.images.small || "", large: data.images.large || "" };
        }
        card._source = (card._source || "") + "+data";
    }

    /** Enriquece cartas JustTCG com HP/ataques/artista etc. do pokemon-tcg-data. */
    async function enrichCards(cards) {
        const candidatesByKey = {};
        await Promise.all(cards.map(async function (card) {
            try {
                const key = normKey(card.set.name) + "|" + card.set.id;
                if (!candidatesByKey[key]) {
                    candidatesByKey[key] = (async function () {
                        let releaseDate = card.set.releaseDate;
                        if (!releaseDate && card.set.id) {
                            const sourceSet = (await getJusttcgSets()).find(function (item) {
                                return item.id === card.set.id;
                            });
                            if (sourceSet) {
                                releaseDate = sourceSet.releaseDate;
                                if (!card.set.name) {
                                    card.set.name = sourceSet.name;
                                }
                            }
                        }
                        return dataSetCandidates(card.set.name, releaseDate);
                    })();
                }
                const candidateIds = await candidatesByKey[key];
                for (let i = 0; i < candidateIds.length; i++) {
                    let blob;
                    try {
                        blob = await getSetBlob(candidateIds[i]);
                    } catch (blobError) {
                        continue;
                    }
                    const match = findDataCard(blob, card);
                    if (match) {
                        mergeDataCard(card, match);
                        return;
                    }
                }
            } catch (error) {
                /* enriquecimento é opcional: mantém a carta como está */
            }
        }));
        return cards;
    }

    /** Busca sem chave: baixa a coleção selecionada e filtra localmente. */
    async function dataSearch(options) {
        const setId = String(options.setId || "");
        if (!setId) {
            throw new Error("Selecione uma coleção no filtro para usar a busca por dados abertos.");
        }
        let blob;
        try {
            blob = await getSetBlob(setId);
        } catch (error) {
            throw new Error("Não foi possível carregar a coleção pela CDN de dados abertos.");
        }
        const parts = nameParts(options.name);
        const filtered = (blob || []).filter(function (item) {
            return blobMatches(item, parts, {
                type: options.type,
                rarity: options.rarity,
                setId: setId
            });
        });
        const cards = filtered.map(function (item) {
            const card = Object.assign({}, item);
            card._source = "data";
            if (!card.images || !(card.images.small || card.images.large)) {
                card.images = { small: "", large: "" };
            }
            return card;
        });
        return { cards: cards, totalCount: cards.length };
    }

    /* ===================== Índice estático (sem chave) ===================== */

    let indexPromise = null;

    function getIndex() {
        if (!indexPromise) {
            indexPromise = fetchJson(INDEX_URL, { timeout: 25000 }).then(function (index) {
                if (!index || !index.c) {
                    throw new Error("índice inválido");
                }
                return index;
            }).catch(function (error) {
                indexPromise = null;
                throw error;
            });
        }
        return indexPromise;
    }

    // Limite de coleções baixadas por busca (as com mais resultados primeiro).
    const MAX_INDEX_SETS = 6;

    function matchesTokens(name, parts) {
        const lower = String(name || "").toLowerCase();
        for (let i = 0; i < parts.length; i++) {
            if (lower.indexOf(parts[i]) === -1) {
                return false;
            }
        }
        return true;
    }

    function pricesFromEntry(entry) {
        const prices = {};
        if (typeof entry[3] === "number") {
            prices.normal = { market: entry[3] };
        }
        if (typeof entry[4] === "number") {
            prices.holofoil = { market: entry[4] };
        }
        if (typeof entry[5] === "number") {
            prices.reverseHolofoil = { market: entry[5] };
        }
        return prices;
    }

    function indexEntryCard(setId, entry, blobCard) {
        const number = String(entry[0] || "");
        const name = String(entry[1] || "");
        const productId = entry[2] || 0;
        const prices = pricesFromEntry(entry);
        let card;

        if (blobCard) {
            card = Object.assign({}, blobCard); // não mutar o blob em cache
        } else {
            card = {
                id: setId + "-" + normNumber(number),
                name: name,
                supertype: "",
                subtypes: [],
                number: number,
                rarity: "",
                images: { small: "", large: "" },
                set: { id: setId, name: setId, printedTotal: 0, releaseDate: "" },
                types: [],
                hp: "",
                attacks: []
            };
        }

        if (productId && tcgplayerImage(productId, "small")) {
            card.images = {
                small: tcgplayerImage(productId, "small"),
                large: tcgplayerImage(productId, "large")
            };
        } else if (!card.images || !(card.images.small || card.images.large)) {
            card.images = { small: "", large: "" };
        }

        if (Object.keys(prices).length) {
            card.tcgplayer = { prices: prices };
        }
        card._source = blobCard ? "index+data" : "index";
        return card;
    }

    function applyClientFilters(cards, options) {
        let result = cards;
        if (options.rarity) {
            result = result.filter(function (card) {
                return String(card.rarity || "").toLowerCase() === String(options.rarity).toLowerCase();
            });
        }
        if (options.type) {
            const withTypes = result.filter(function (card) {
                return (card.types || []).length > 0;
            });
            if (withTypes.length) {
                result = withTypes.filter(function (card) {
                    return card.types.includes(options.type);
                });
            }
            // Se o enriquecimento falhou (nenhum tipo conhecido), ignora o
            // filtro em vez de devolver zero resultados injustamente.
        }
        return result;
    }

    async function indexSearch(options) {
        const index = await getIndex();
        const parts = nameParts(options.name);

        const bySet = {};
        let totalMatches = 0;
        Object.keys(index.c).forEach(function (setId) {
            if (options.setId && setId !== options.setId) {
                return;
            }
            const kept = index.c[setId].filter(function (entry) {
                return !parts.length || matchesTokens(entry[1], parts);
            });
            if (kept.length) {
                bySet[setId] = kept;
                totalMatches += kept.length;
            }
        });

        if (!totalMatches) {
            return { cards: [], totalCount: 0 };
        }

        let wantedSets = Object.keys(bySet);
        if (wantedSets.length > MAX_INDEX_SETS) {
            wantedSets.sort(function (a, b) {
                return bySet[b].length - bySet[a].length;
            });
            wantedSets = wantedSets.slice(0, MAX_INDEX_SETS);
        }

        const cards = [];
        for (let i = 0; i < wantedSets.length; i++) {
            const setId = wantedSets[i];
            let blob = null;
            let blobMap = null;
            try {
                blob = await getSetBlob(setId);
                blobMap = {};
                (blob || []).forEach(function (item) {
                    blobMap[normNumber(item.number)] = item;
                });
            } catch (blobError) {
                blob = null;
            }
            bySet[setId].forEach(function (entry) {
                const blobCard = blobMap ? (blobMap[normNumber(entry[0])] || null) : null;
                cards.push(indexEntryCard(setId, entry, blobCard));
            });
        }

        const filtered = applyClientFilters(cards, options);
        return { cards: filtered, totalCount: Math.max(totalMatches, filtered.length) };
    }

    /* ===================== Provedor pokemontcg.io v2 ===================== */

    function buildNameQuery(name) {
        const clean = String(name || "").replace(/["*]/g, "").trim();
        if (!clean) {
            return "";
        }
        // Nomes com mais de uma palavra viram busca por frase exata;
        // palavras únicas ganham curinga para buscar por prefixo (ex.: "char*").
        return clean.includes(" ") ? 'name:"' + clean + '"' : "name:" + clean + "*";
    }

    async function pokemontcgSearch(options) {
        const params = new URLSearchParams();
        params.set("pageSize", String(Math.min(Math.max(options.pageSize || 24, 1), 250)));
        
        const page = Math.max(options.page || 1, 1);
        params.set("page", String(page));

        const parts = [];
        const nameQuery = buildNameQuery(options.name);
        if (nameQuery) {
            parts.push(nameQuery);
        }
        if (options.type) {
            parts.push("types:" + options.type);
        }
        if (options.rarity) {
            parts.push('rarity:"' + options.rarity + '"');
        }
        if (options.setId) {
            parts.push("set.id:" + options.setId);
        }
        if (parts.length) {
            params.set("q", parts.join(" "));
        }
        if (POKEMONTCG_KEY) {
            params.set("apiKey", POKEMONTCG_KEY);
        }

        const data = await fetchJson(POKEMONTCG_BASE + "/cards?" + params.toString(), { timeout: 10000 });
        const cards = (data && data.data) || [];
        return { cards: cards, totalCount: (data && data.totalCount) || cards.length };
    }

    /* ===================== Busca JustTCG ===================== */

    /** Traduz o id de coleção (pokemon-tcg-data) para o id usado pela JustTCG. */
    async function matchJustTcgSetId(dataSetId) {
        let dataSets = [];
        try {
            dataSets = await getDataSets();
        } catch (error) {
            return "";
        }
        const source = dataSets.find(function (item) {
            return item.id === dataSetId;
        });
        if (!source) {
            return "";
        }
        const target = normKey(source.name);
        if (!target) {
            return "";
        }
        const justtcgSets = await getJusttcgSets();
        const exact = justtcgSets.find(function (item) {
            return normKey(item.name) === target;
        });
        if (exact) {
            return exact.id;
        }
        const contained = justtcgSets.filter(function (item) {
            const candidate = normKey(item.name);
            return candidate.length >= 3 && (candidate.indexOf(target) > -1 || target.indexOf(candidate) > -1);
        });
        if (contained.length === 1) {
            return contained[0].id;
        }
        const dated = contained.filter(function (item) {
            return datesClose(item.releaseDate, source.releaseDate);
        });
        return dated.length ? dated[0].id : "";
    }

    async function justtcgSearch(options) {
        const params = new URLSearchParams();
        params.set("game", "pokemon");
        const limit = Math.min(Math.max(options.pageSize || 20, 1), 100);
        params.set("limit", String(limit));
        
        const page = Math.max(options.page || 1, 1);
        const offset = (page - 1) * limit;
        params.set("offset", String(offset));

        const name = String(options.name || "").trim();
        if (name) {
            params.set("q", name);
        }

        let matchedSetId = "";
        if (options.setId) {
            matchedSetId = await matchJustTcgSetId(options.setId);
            if (matchedSetId) {
                params.set("set", matchedSetId);
            }
        }

        const body = await fetchJson(JUSTTCG_BASE + "/cards?" + params.toString(), {
            headers: justtcgHeaders(),
            timeout: 15000
        });

        const raw = (body && body.data) || [];
        let cards = raw.map(normalizeJustTcgCard);
        await enrichCards(cards);

        if (options.setId && !matchedSetId) {
            const sameSet = cards.filter(function (card) {
                return card.set && card.set.id === options.setId;
            });
            if (sameSet.length) {
                cards = sameSet;
            }
        }

        const filtered = applyClientFilters(cards, options);
        const total = body && body.meta && typeof body.meta.total === "number"
            ? body.meta.total
            : filtered.length;
        return { cards: filtered, totalCount: total };
    }

/* ===================== Erros e orquestração ===================== */

    function describeProviderError(provider, error) {
        const status = error && error.status;
        if (provider === "JustTCG") {
            if (status === 401) {
                return "JustTCG: chave inválida ou ausente";
            }
            if (status === 429) {
                return "JustTCG: limite diário do plano gratuito atingido";
            }
            if (status === 403) {
                return "JustTCG: acesso bloqueado para o plano gratuito";
            }
            return "JustTCG: sem conexão";
        }
        if (provider === "índice local") {
            if (status === 404) {
                return "índice local: arquivo não encontrado (sirva o site via HTTP)";
            }
            return "índice local: falha" + (status ? " HTTP " + status : " de conexão");
        }
        if (provider === "pokemontcg.io") {
            return status ? "pokemontcg.io: erro HTTP " + status : "pokemontcg.io: sem conexão (sua rede pode bloquear esse site)";
        }
        return provider + ": falha" + (status ? " HTTP " + status : " de conexão");
    }

    function buildCombinedError(options, errors) {
        let message = "Não foi possível buscar as cartas (" + errors.join("; ") + ").";
        message += " Dicas: 1) verifique se o site está sendo servido por HTTP (botão Go Live); " +
            "2) selecione uma Coleção no filtro; " +
            "3) configure uma chave gratuita da JustTCG (justtcg.com) pelo botão 🔑 Chave API dos filtros.";
        return message;
    }

    /**
     * Busca cartas. Opções: { name, type, rarity, setId, pageSize }.
     * Tenta JustTCG → dados abertos (se uma coleção estiver selecionada) → pokemontcg.io.
     */
    async function searchCards(options) {
        const opts = options || {};
        const errors = [];

        if (justtcgConfigured()) {
            try {
                return await justtcgSearch(opts);
            } catch (error) {
                errors.push(describeProviderError("JustTCG", error));
            }
        }

        try {
            return await indexSearch(opts);
        } catch (error) {
            errors.push(describeProviderError("índice local", error));
        }

        if (opts.setId) {
            try {
                return await dataSearch(opts);
            } catch (error) {
                errors.push(describeProviderError("dados abertos (CDN)", error));
            }
        }

        try {
            return await pokemontcgSearch(opts);
        } catch (error) {
            errors.push(describeProviderError("pokemontcg.io", error));
        }

        throw new Error(buildCombinedError(opts, errors));
    }

    /** Lista de coleções para o filtro (dados abertos, com fallback pokemontcg.io). */
    async function getSets() {
        try {
            const sets = await getDataSets();
            return sets.slice().sort(function (a, b) {
                return String(b.releaseDate || "").localeCompare(String(a.releaseDate || ""));
            }).map(function (set) {
                return {
                    id: set.id,
                    name: set.name,
                    releaseDate: set.releaseDate,
                    printedTotal: set.printedTotal,
                    total: set.total,
                    series: set.series
                };
            });
        } catch (error) {
            const params = new URLSearchParams();
            params.set("select", "id,name,releaseDate,printedTotal");
            params.set("pageSize", "250");
            if (POKEMONTCG_KEY) {
                params.set("apiKey", POKEMONTCG_KEY);
            }
            const data = await fetchJson(POKEMONTCG_BASE + "/sets?" + params.toString(), { timeout: 12000 });
            return ((data && data.data) || []).slice().sort(function (a, b) {
                return String(b.releaseDate || "").localeCompare(String(a.releaseDate || ""));
            });
        }
    }

    /* ===================== Preços e utilitários ===================== */

    const PRICE_PRIORITY = ["normal", "holofoil", "reverseHolofoil", "1stEdition", "1stEditionHolofoil", "unlimited", "limited"];

    /**
     * Extrai preços de uma carta:
     *  - tcgplayer: preço de mercado (USD) da variação mais relevante;
     *  - cardmarket: preço de tendência (EUR), quando o provedor fornece.
     */
    function getCardPrices(card) {
        if (!card) {
            return { tcgplayer: null, tcgplayerVariant: null, cardmarket: null };
        }

        const prices = card.tcgplayer && card.tcgplayer.prices ? card.tcgplayer.prices : {};

        let tcgMarket = null;
        let tcgVariant = null;

        PRICE_PRIORITY.forEach(function (variant) {
            if (tcgMarket === null && prices[variant] && typeof prices[variant].market === "number") {
                tcgMarket = prices[variant].market;
                tcgVariant = variant;
            }
        });

        if (tcgMarket === null) {
            Object.keys(prices).forEach(function (variant) {
                if (tcgMarket === null && prices[variant] && typeof prices[variant].market === "number") {
                    tcgMarket = prices[variant].market;
                    tcgVariant = variant;
                }
            });
        }

        const cmPrices = card.cardmarket && card.cardmarket.prices ? card.cardmarket.prices : {};
        const cmTrend = typeof cmPrices.trendPrice === "number"
            ? cmPrices.trendPrice
            : (typeof cmPrices.averageSellPrice === "number" ? cmPrices.averageSellPrice : null);

        return {
            tcgplayer: tcgMarket,
            tcgplayerVariant: tcgVariant,
            cardmarket: cmTrend
        };
    }

    /** Formata um valor monetário em pt-BR (ex.: "US$ 12,50"). Retorna null se inválido. */
    function formatPrice(value, currency) {
        if (typeof value !== "number" || isNaN(value)) {
            return null;
        }
        try {
            return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "USD" }).format(value);
        } catch (formatError) {
            return (currency === "EUR" ? "€ " : "US$ ") + value.toFixed(2).replace(".", ",");
        }
    }

    function typeLabel(type) {
        return TYPE_LABELS[type] || type || "";
    }

    function energyColor(type) {
        return ENERGY_COLORS[type] || "#c9c9d4";
    }

    function variantLabel(variant) {
        return VARIANT_LABELS[variant] || variant;
    }

    const api = {
        searchCards: searchCards,
        getSets: getSets,
        getCardPrices: getCardPrices,
        formatPrice: formatPrice,
        typeLabel: typeLabel,
        energyColor: energyColor,
        variantLabel: variantLabel,
        justtcgConfigured: justtcgConfigured,
        getJustTcgKey: getJustTcgKey,
        saveJustTcgKey: saveJustTcgKey,
        TYPE_LABELS: TYPE_LABELS,
        ENERGY_COLORS: ENERGY_COLORS
    };

    global.PokemonTCG = api;

    // Permite usar o cliente fora do navegador (ex.: testes via Node.js).
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof window !== "undefined" ? window : globalThis);
