"""Rotary terms and the wording Rotary uses for them in each UI language (fr de it ja ko pt es).

Used by fix_terms.py to find labels where a Rotary term is translated with a generic word instead of the term clubs in
that country use (e.g. Spanish "Servicio Profesional" for Vocational Service, French "Action intérieure" for Club
Service). Each entry: English term -> {lang: [accepted forms, lower case; any one must appear]}.
"""

TERMS = {
    "Rotary Foundation": {"fr": ["fondation rotary"], "de": ["rotary foundation"], "it": ["fondazione rotary"],
                          "ja": ["ロータリー財団"], "ko": ["로타리재단", "로타리 재단"], "pt": ["fundação rotária"],
                          "es": ["fundación rotaria"]},
    "Vocational Service": {"fr": ["action professionnelle"], "de": ["berufsdienst"], "it": ["azione professionale"],
                           "ja": ["職業奉仕"], "ko": ["직업봉사"], "pt": ["profission"], "es": ["servicio profesional"]},
    "Club Service": {"fr": ["action intérieure"], "de": ["clubdienst"], "it": ["azione interna"], "ja": ["クラブ奉仕"],
                     "ko": ["클럽봉사"], "pt": ["ao clube", "internos", "no clube"], "es": ["servicio en el club"]},
    "Community Service": {"fr": ["intérêt public"], "de": ["gemeindienst"], "it": ["pubblico interesse"],
                          "ja": ["社会奉仕"], "ko": ["사회봉사"], "pt": ["comunidade"], "es": ["comunidad"]},
    "International Service": {"fr": ["action internationale"], "de": ["internationaler dienst", "internationale"],
                              "it": ["azione internazionale"], "ja": ["国際奉仕"], "ko": ["국제봉사"],
                              "pt": ["internacion"], "es": ["servicio internacional"]},
    "Youth Service": {"fr": ["jeunesse", "nouvelles générations"], "de": ["jugenddienst"], "it": ["giovani", "nuove generazioni"],
                      "ja": ["青少年奉仕"], "ko": ["청소년봉사"], "pt": ["novas gerações"], "es": ["nuevas generaciones"]},
    "New Generations": {"fr": ["nouvelles générations", "jeunesse"], "de": ["jugend", "neue generationen"],
                        "it": ["nuove generazioni", "giovani"], "ja": ["青少年", "新世代"], "ko": ["청소년", "새로운 세대"],
                        "pt": ["novas gerações"], "es": ["nuevas generaciones"]},
    "Areas of Focus": {"fr": ["axes stratégiques", "axe stratégique"], "de": ["schwerpunkt"], "it": ["aree d'intervento", "aree di intervento"],
                       "ja": ["重点分野"], "ko": ["중점분야", "중점 분야"], "pt": ["áreas de enfoque", "área de enfoque"],
                       "es": ["áreas de interés", "área de interés"]},
    "Area of Focus": {"fr": ["axe stratégique", "axes stratégiques"], "de": ["schwerpunkt"], "it": ["area d'intervento", "aree d'intervento", "area di intervento"],
                      "ja": ["重点分野"], "ko": ["중점분야", "중점 분야"], "pt": ["área de enfoque", "áreas de enfoque"],
                      "es": ["área de interés", "áreas de interés"]},
    "Assistant Governor": {"fr": ["adjoint du gouverneur", "adjoints du gouverneur", "assistant"], "de": ["assistant governor", "assistent"],
                           "it": ["assistente del governatore", "assistenti del governatore"], "ja": ["ガバナー補佐"],
                           "ko": ["총재지역대표", "지역대표"], "pt": ["governador assistente", "governadores assistentes"],
                           "es": ["gobernador asistente", "gobernadores asistentes"]},
    "District Governor": {"fr": ["gouverneur"], "de": ["governor"], "it": ["governatore"], "ja": ["ガバナー"],
                          "ko": ["총재"], "pt": ["governador"], "es": ["gobernador"]},
    "Rotary Year": {"fr": ["année rotarienne", "années rotariennes"], "de": ["rotary-jahr", "rotaryjahr"], "it": ["anno rotariano", "anni rotariani"],
                    "ja": ["ロータリー年度", "年度"], "ko": ["로타리 연도", "로타리연도", "연도"], "pt": ["ano rotário", "anos rotários"],
                    "es": ["año rotario", "años rotarios"]},
    "Paul Harris Fellow": {"fr": ["paul harris"], "de": ["paul harris"], "it": ["paul harris"], "ja": ["ポール・ハリス"],
                           "ko": ["폴 해리스"], "pt": ["paul harris"], "es": ["paul harris"]},
    "Annual Fund": {"fr": ["fonds annuel"], "de": ["jahresfonds", "annual fund"], "it": ["fondo annuale"], "ja": ["年次基金"],
                    "ko": ["연차기금", "연간 기금"], "pt": ["fundo anual"], "es": ["fondo anual"]},
    "Board of Directors": {"fr": ["comité", "conseil d'administration"], "de": ["vorstand"], "it": ["consiglio direttivo"],
                           "ja": ["理事会"], "ko": ["이사회"], "pt": ["conselho diretor"], "es": ["junta directiva"]},
    "Dues": {"fr": ["cotisation"], "de": ["beitr"], "it": ["quot"], "ja": ["会費"], "ko": ["회비"], "pt": ["quota", "contribui", "mensalidade", "anuidade"],
             "es": ["cuota"]},
}
