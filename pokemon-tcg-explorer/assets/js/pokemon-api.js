/**
 * Cliente da API Pokémon TCG v2 — https://pokemontcg.io
 * Documentação: https://docs.pokemontcg.io/
 *
 * A API é gratuita:
 *   - Sem chave: até 1.000 requisições por dia por IP.
 *   - Com chave gratuita (crie em https://dev.pokemontcg.io): até 20.000 por dia.
 * Se desejar, cole sua chave na constante API_KEY abaixo.
 */
(function (global) {
    "use strict";

    const BASE_URL = "https://api.pokemontcg.io/v2";
    const API_KEY = "";

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

    async function request(path, params) {
        const url = BASE_URL + path + (params ? "?" + params.toString() : "");
        const options = { headers: { Accept: "application/json" } };

        if (API_KEY) {
            options.headers["X-Api-Key"] = API_KEY;
        }

        let response;
        try {
            response = await fetch(url, options);
        } catch (networkError) {
            throw new Error("Não foi possível conectar à API do Pokémon TCG. Verifique sua conexão com a internet.");
        }

        if (!response.ok) {
            if (response.status === 429) {
                throw new Error("Limite de requisições da API atingido. Aguarde alguns instantes e tente novamente.");
            }
            if (response.status === 400) {
                throw new Error("Termo de busca inválido. Tente pesquisar por outro nome.");
            }
            throw new Error("A API do Pokémon TCG respondeu com o erro " + response.status + ".");
        }

        return response.json();
    }

    function buildNameQuery(name) {
        const clean = String(name).replace(/["*]/g, "").trim();
        if (!clean) {
            return "";
        }
        // Nomes com mais de uma palavra viram busca por frase exata;
        // palavras únicas ganham curinga para buscar por prefixo (ex.: "char*").
        return clean.includes(" ") ? 'name:"' + clean + '"' : "name:" + clean + "*";
    }

    /**
     * Busca cartas. Opções: { name, type, rarity, setId, page, pageSize }.
     * `type` usa os valores da API (Fire, Water, Grass, ...).
     */
    async function searchCards(options) {
        const opts = options || {};
        const parts = [];

        const nameQuery = buildNameQuery(opts.name || "");
        if (nameQuery) {
            parts.push(nameQuery);
        }
        if (opts.type) {
            parts.push("types:" + opts.type);
        }
        if (opts.rarity) {
            parts.push('rarity:"' + String(opts.rarity).replace(/["*]/g, "") + '"');
        }
        if (opts.setId) {
            parts.push("set.id:" + opts.setId);
        }

        const params = new URLSearchParams();
        if (parts.length) {
            params.set("q", parts.join(" "));
        }
        params.set("page", String(opts.page || 1));
        params.set("pageSize", String(opts.pageSize || 24));

        const data = await request("/cards", params);
        return {
            cards: data.data || [],
            totalCount: data.totalCount || 0,
            page: data.page || 1
        };
    }

    /** Lista todos os sets (mais recentes primeiro) para o filtro "Set". */
    async function getSets() {
        const params = new URLSearchParams();
        params.set("select", "id,name,releaseDate,printedTotal");
        params.set("pageSize", "250");

        const data = await request("/sets", params);
        return (data.data || []).slice().sort(function (a, b) {
            return String(b.releaseDate || "").localeCompare(String(a.releaseDate || ""));
        });
    }

    /**
     * Extrai preços de uma carta:
     *  - tcgplayer: preço "market" (USD) da variação mais relevante;
     *  - cardmarket: preço de tendência (EUR).
     */
    function getCardPrices(card) {
        if (!card) {
            return { tcgplayer: null, tcgplayerVariant: null, cardmarket: null };
        }

        const prices = card.tcgplayer && card.tcgplayer.prices ? card.tcgplayer.prices : {};
        const priority = ["normal", "holofoil", "reverseHolofoil", "1stEdition", "1stEditionHolofoil", "unlimited", "limited"];

        let tcgMarket = null;
        let tcgVariant = null;

        priority.forEach(function (variant) {
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
        TYPE_LABELS: TYPE_LABELS,
        ENERGY_COLORS: ENERGY_COLORS
    };

    global.PokemonTCG = api;

    // Permite usar o cliente fora do navegador (ex.: testes via Node.js).
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof window !== "undefined" ? window : globalThis);
