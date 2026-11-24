/** Void Defense UI strings across all 9 supported languages.
 * English is the source; non-English rows are machine-translated first passes. */
import type { TranslationRow } from "./languages.ts";

export const VOID_TEXT = [
  // Navigation tabs
  ["void.tab.battle", "Battlefield", "Campo de batalla", "Champ de bataille", "Schlachtfeld", "Campo de Batalha", "Campo di battaglia", "戦場", "전장", "战场"],
  ["void.tab.network", "Global Tech Network", "Red Tecnológica Global", "Réseau Techno Global", "Globales Tech-Netz", "Rede Tecnológica Global", "Rete Tecnologica Globale", "グローバル技術網", "글로벌 기술 네트워크", "全球科技网络"],
  ["void.tab.operations", "Resistance Ops", "Operaciones", "Opérations", "Widerstands-Ops", "Operações", "Operazioni", "レジスタンス作戦", "저항군 작전", "抵抗行动"],
  ["void.tab.map", "Resistance Map", "Mapa de Resistencia", "Carte de Résistance", "Widerstandskarte", "Mapa da Resistência", "Mappa Resistenza", "レジスタンス地図", "저항군 지도", "抵抗地图"],

  // Topbar & currencies
  ["void.curr.supplies", "Supplies", "Suministros", "Ressources", "Vorräte", "Suprimentos", "Rifornimenti", "物資", "보급품", "补给"],
  ["void.curr.essence", "Essence", "Esencia", "Essence", "Essenz", "Essência", "Essenza", "エッセンス", "정수", "精华"],
  ["void.curr.sparks", "Sparks", "Chispas", "Étincelles", "Funken", "Faíscas", "Scintille", "スパーク", "불꽃", "火花"],
  ["void.mode.underSiege", "Under Siege", "Bajo Asedio", "Sous Siège", "Unter Belagerung", "Sob Cerco", "Sotto Assedio", "包囲戦", "포위전", "围城模式"],
  ["void.mode.buildAndWatch", "Build & Watch", "Construir y Ver", "Construire & Voir", "Bauen & Zusehen", "Construir e Ver", "Costruisci e Guarda", "建設＆観戦", "건설 및 관전", "建造与观战"],

  // Title screen
  ["void.title.subtitle", "Contain the Violet Breach", "Contén la Brecha Violeta", "Contenez la Brèche Violette", "Dämme den Violetten Riss ein", "Contenha a Fenda Violeta", "Contieni la Breccia Viola", "紫の裂け目を封鎖せよ", "보라색 균열을 봉쇄하라", "遏制紫罗兰裂隙"],
  ["void.title.continue", "Continue", "Continuar", "Continuer", "Fortsetzen", "Continuar", "Continua", "続ける", "계속하기", "继续"],
  ["void.title.newGame", "New Game", "Nueva Partida", "Nouvelle Partie", "Neues Spiel", "Novo Jogo", "Nuova Partita", "ニューゲーム", "새 게임", "新游戏"],
  ["void.title.settings", "Settings", "Ajustes", "Paramètres", "Einstellungen", "Configurações", "Impostazioni", "設定", "설정", "设置"],

  // Battle HUD & Side Panel
  ["void.hud.command", "Command", "Comando", "Commandement", "Befehl", "Comando", "Comando", "司令", "지휘", "指挥"],
  ["void.hud.telemetry", "Telemetry", "Telemetría", "Télémétrie", "Telemetrie", "Telemetria", "Telemetria", "テレメトリ", "원격 측정", "遥测"],
  ["void.hud.selected", "Selected Unit / Structure", "Unidad / Estructura", "Unité / Structure", "Ausgewählte Einheit", "Unidade / Estrutura", "Unità / Struttura", "選択中のユニット", "선택된 유닛/건물", "已选单位/建筑"],
  ["void.hud.emptyInsp", "Tap any tower or building on the map to inspect or sell it.", "Toca cualquier torre o edificio en el mapa para inspeccionarlo.", "Touchez une tour ou un bâtiment sur la carte pour l'inspecter.", "Tippe auf einen Turm oder ein Gebäude, um es zu prüfen.", "Toque em qualquer torre ou edifício para inspecionar.", "Tocca una torre o un edificio sulla mappa per ispezionarlo.", "マップ上のタワーや建物をタップして確認します。", "지도에서 타워나 건물을 탭하여 확인하세요.", "点击地图上的防御塔或建筑以查看或出售。"],
  ["void.hud.goal", "Contain the Void breach before the city falls.", "Contén la brecha del Vacío antes de que caiga la ciudad.", "Contenez la brèche du Vide avant la chute de la ville.", "Dämme den Leere-Riss ein, bevor die Stadt fällt.", "Contenha a fenda do Vazio antes que a cidade caia.", "Contieni la breccia del Vuoto prima che la città cada.", "都市が陥落する前にヴォイドの裂け目を封鎖せよ。", "도시가 함락되기 전에 공허 균열을 봉쇄하세요.", "在城市沦陷前遏制虚空裂隙。"],
  ["void.hud.startBattle", "Start Battle", "Iniciar Batalla", "Lancer Bataille", "Kampf Starten", "Iniciar Batalha", "Inizia Battaglia", "戦闘開始", "전투 시작", "开始战斗"],
  ["void.hud.pause", "Pause", "Pausa", "Pause", "Pause", "Pausa", "Pausa", "一時停止", "일시정지", "暂停"],
  ["void.hud.resume", "Resume", "Reanudar", "Reprendre", "Fortsetzen", "Retomar", "Riprendi", "再開", "재개", "继续"],
  ["void.hud.retry", "Retry", "Reintentar", "Réessayer", "Neu starten", "Tentar de novo", "Riprova", "リトライ", "재시도", "重试"],
  ["void.hud.voidEnergy", "Void", "Vacío", "Vide", "Leere", "Vazio", "Vuoto", "ヴォイド", "공허", "虚空"],
  ["void.hud.contacts", "Contacts", "Contactos", "Contacts", "Kontakte", "Contatos", "Contatti", "接触", "접촉", "接触"],
  ["void.hud.units", "Units", "Unidades", "Unités", "Einheiten", "Unidades", "Unità", "ユニット", "유닛", "单位"],
  ["void.hud.time", "Time", "Tiempo", "Temps", "Zeit", "Tempo", "Tempo", "時間", "시간", "时间"],
  ["void.tod.day", "Day", "Día", "Jour", "Tag", "Dia", "Giorno", "昼", "낮", "白昼"],
  ["void.tod.sunset", "Sunset", "Ocaso", "Crépuscule", "Abend", "Pôr do Sol", "Tramonto", "夕暮れ", "석양", "黄昏"],
  ["void.tod.night", "Night", "Noche", "Nuit", "Nacht", "Noite", "Notte", "夜", "밤", "深夜"],

  // Inspector
  ["void.insp.lv", "Lv {n}", "Nv {n}", "Niv {n}", "St {n}", "Nv {n}", "Lv {n}", "Lv {n}", "Lv {n}", "等级 {n}"],
  ["void.insp.hp", "HP", "PV", "PV", "LP", "PV", "PS", "HP", "체력", "生命"],
  ["void.insp.upgrade", "Lv {n} ({cost})", "Nv {n} ({cost})", "Niv {n} ({cost})", "St {n} ({cost})", "Nv {n} ({cost})", "Lv {n} ({cost})", "Lv {n} ({cost})", "Lv {n} ({cost})", "升至{n}级 ({cost})"],
  ["void.insp.maxLv", "Max Lv", "Nv Máx", "Niv Max", "Max St", "Nv Máx", "Lv Max", "最大Lv", "최대 레벨", "已满级"],
  ["void.insp.focus", "Focus", "Enfocar", "Cibler", "Fokus", "Focar", "Mira", "照準", "집중", "聚焦"],
  ["void.insp.sell", "Sell (+{n})", "Vender (+{n})", "Vendre (+{n})", "Verkaufen (+{n})", "Vender (+{n})", "Vendi (+{n})", "売却 (+{n})", "판매 (+{n})", "出售 (+{n})"],

  // Coach
  ["void.coach.skip", "Skip", "Saltar", "Passer", "Auslassen", "Pular", "Salta", "スキップ", "건너뛰기", "跳过"],
  ["void.coach.next", "Next", "Siguiente", "Suivant", "Weiter", "Próximo", "Avanti", "次へ", "다음", "下一步"],
  ["void.coach.gotIt", "Got it", "Entendido", "Compris", "Verstanden", "Entendi", "Capito", "了解", "확인", "明白了"],
  ["void.coach.1.title", "1/4 · Contain the Breach", "1/4 · Contén la Brecha", "1/4 · Contenir la Brèche", "1/4 · Riss Eindämmen", "1/4 · Conter a Fenda", "1/4 · Contieni la Breccia", "1/4 · 裂け目の封鎖", "1/4 · 균열 봉쇄", "1/4 · 遏制裂隙"],
  ["void.coach.1.body", "The Void consumes the city outward. Surviving buildings generate Supplies to fund your defenses.", "El Vacío consume la ciudad hacia afuera. Los edificios intactos generan Suministros.", "Le Vide consume la ville vers l'extérieur. Les bâtiments intacts génèrent des Ressources.", "Die Leere verschlingt die Stadt. Intakte Gebäude erzeugen Vorräte für deine Abwehr.", "O Vazio consome a cidade. Edifícios intactos geram Suprimentos para suas defesas.", "Il Vuoto consuma la città. Gli edifici intatti generano Rifornimenti per le difese.", "ヴォイドは外へ向かって都市を侵食します。残存建物が物資を生み出します。", "공허가 도시를 잠식합니다. 생존 건물이 방어에 필요한 보급품을 생산합니다.", "虚空向外吞噬城市。幸存建筑会产生补给来支持你的防御。"],
  ["void.coach.2.title", "2/4 · Place a Matter Cannon", "2/4 · Coloca un Cañón de Materia", "2/4 · Placer un Canon à Matière", "2/4 · Materiekanone Platzieren", "2/4 · Posicionar Canhão de Matéria", "2/4 · Piazza un Cannone Materia", "2/4 · マター砲を設置", "2/4 · 물질포 배치", "2/4 · 放置物质炮"],
  ["void.coach.2.body", "Pick Matter below, then tap a spot near the Void's edge. The cannon fires matter back into the Void and rebuilds the ground.", "Elige Materia abajo y toca cerca del borde del Vacío. El cañón dispara materia y reconstruye el suelo.", "Choisissez Matière ci-dessous, puis touchez près du Vide pour reconstruire le sol.", "Wähle unten Materie und tippe nahe am Rand der Leere, um Boden wiederaufzubauen.", "Escolha Matéria abaixo e toque perto da borda do Vazio para reconstruir o solo.", "Scegli Materia sotto e tocca vicino al bordo del Vuoto per ricostruire il terreno.", "下のマターを選び、ヴォイドの端の近くをタップして地面を再建します。", "아래에서 물질을 선택한 뒤 공허 가장자리 근처를 탭해 지면을 복구하세요.", "选择下方的物质，然后点击虚空边缘附近。炮塔会发射物质击退虚空并重建地面。"],
  ["void.coach.3.title", "3/4 · Deploy Engineers", "3/4 · Despliega Ingenieros", "3/4 · Déployer des Ingénieurs", "3/4 · Techniker Einsetzen", "3/4 · Enviar Engenheiros", "3/4 · Schiera Ingegneri", "3/4 · エンジニアを配備", "3/4 · 공병 배치", "3/4 · 部署工程师"],
  ["void.coach.3.body", "Select Repair (Repair Depot) to deploy engineers that salvage rubble and mend buildings.", "Elige Reparar (Depósito) para desplegar ingenieros que recuperan escombros y reparan edificios.", "Choisissez Réparer pour déployer des ingénieurs qui récupèrent les débris et réparent.", "Wähle Reparatur, um Techniker einzusetzen, die Trümmer bergen und Gebäude reparieren.", "Selecione Reparar para enviar engenheiros que recuperam escombros e consertam prédios.", "Seleziona Ripara per schierare ingegneri che recuperano macerie e riparano edifici.", "リペアを選び、瓦礫を回収して建物を修復するエンジニアを配備します。", "수리를 선택해 잔해를 회수하고 건물을 수리하는 공병을 배치하세요.", "选择修理站以部署工程师，回收废墟并修复建筑。"],
  ["void.coach.4.title", "4/4 · Start Containment", "4/4 · Iniciar Contención", "4/4 · Lancer le Confinement", "4/4 · Eindämmung Starten", "4/4 · Iniciar Contenção", "4/4 · Avvia Contenimento", "4/4 · 封鎖を開始", "4/4 · 봉쇄 시작", "4/4 · 开始遏制"],
  ["void.coach.4.body", "Press Start Battle when ready. Use orbital Strikes if the Void breaks through.", "Pulsa Iniciar Batalla cuando estés listo. Usa Ataques orbitales si el Vacío avanza.", "Appuyez sur Lancer Bataille quand vous êtes prêt. Utilisez les Frappes si besoin.", "Drücke Kampf Starten, wenn du bereit bist. Nutze Schläge bei einem Durchbruch.", "Pressione Iniciar Batalha quando pronto. Use Ataques se o Vazio avançar.", "Premi Inizia Battaglia quando sei pronto. Usa gli Attacchi se il Vuoto avanza.", "準備ができたら戦闘開始を押してください。突破されたら軌道ストライクを使います。", "준비가 되면 전투 시작을 누르세요. 공허가 돌파하면 궤도 타격을 사용하세요.", "准备好后按“开始战斗”。如果虚空突破防线，可使用轨道打击。"],

  // Outcome modal
  ["void.outcome.lost", "CITY LOST", "Ciudad Perdida", "Ville Perdue", "Stadt Verloren", "Cidade Perdida", "Città Persa", "都市陥落", "도시 함락", "城市沦陷"],
  ["void.outcome.pyrrhic", "PYRRHIC CONTAINMENT", "Contención Pírrica", "Confinement Pyrrhique", "Pyrrhussieg", "Contenção Pírrica", "Contenimento Pirrico", "辛勝封鎖", "신승 봉쇄", "惨胜遏制"],
  ["void.outcome.contained", "BREACH CONTAINED", "Brecha Contenida", "Brèche Contenue", "Riss Eingedämmt", "Fenda Contida", "Breccia Contenuta", "裂け目封鎖", "균열 봉쇄 완료", "裂隙已遏制"],
  ["void.outcome.flawless", "FLAWLESS DEFENSE", "Defensa Impecable", "Défense Parfaite", "Makellose Abwehr", "Defesa Impecável", "Difesa Perfetta", "完全防衛", "완벽한 방어", "完美防御"],
  ["void.outcome.preserved", "City Preserved", "Ciudad Preservada", "Ville Préservée", "Stadt Erhalten", "Cidade Preservada", "Città Preservata", "都市残存率", "도시 보존율", "城市保存率"],
  ["void.outcome.best", "Sector Best", "Mejor del Sector", "Record du Secteur", "Sektor-Bestwert", "Melhor do Setor", "Record Settore", "セクター最高", "구역 최고 기록", "扇区最佳"],
  ["void.outcome.essenceEarned", "Void Essence", "Esencia del Vacío", "Essence du Vide", "Leere-Essenz", "Essência do Vazio", "Essenza del Vuoto", "ヴォイドエッセンス", "공허의 정수", "虚空精华"],
  ["void.outcome.sparksEarned", "Sparks of Defiance", "Chispas de Desafío", "Étincelles de Défi", "Trotzfunken", "Faíscas de Desafio", "Scintille di Sfida", "抗戦のスパーク", "저항의 불꽃", "抗争火花"],
  ["void.outcome.retry", "Retry Sector", "Reintentar Sector", "Réessayer Secteur", "Sektor Neu Starten", "Tentar Setor", "Riprova Settore", "セクター再挑戦", "구역 재시도", "重试扇区"],
  ["void.outcome.tech", "Open Tech Network", "Abrir Red Tech", "Ouvrir Réseau Tech", "Tech-Netz öffnen", "Abrir Rede Tech", "Apri Rete Tech", "技術網を開く", "기술 네트워크 열기", "打开科技网络"],
  ["void.outcome.next", "Next Sector", "Siguiente Sector", "Secteur Suivant", "Nächster Sektor", "Próximo Setor", "Prossimo Settore", "次のセクター", "다음 구역", "下一扇区"],
  ["void.outcome.map", "Back to Map", "Volver al Mapa", "Retour à la Carte", "Zurück zur Karte", "Voltar ao Mapa", "Torna alla Mappa", "地図へ戻る", "지도로 돌아가기", "返回地图"],

  // Tech Network
  ["void.tech.title", "Resistance Global Technology Network", "Red Tecnológica Global de Resistencia", "Réseau Techno Global de Résistance", "Globales Techniknetz des Widerstands", "Rede Tecnológica Global da Resistência", "Rete Tecnologica Globale", "レジスタンス・グローバル技術網", "저항군 글로벌 기술 네트워크", "抵抗组织全球科技网络"],
  ["void.tech.blurb", "All unlocked towers, strikes, AI logic, and passives apply globally across every run. Free between-run refunds.", "Todas las mejoras se aplican globalmente en cada partida. Reembolsos gratis entre partidas.", "Toutes les améliorations s'appliquent globalement. Remboursements gratuits entre parties.", "Alle Freischaltungen gelten global für jeden Lauf. Kostenlose Rückerstattung zwischen Läufen.", "Todas as melhorias valem globalmente. Reembolso gratuito entre partidas.", "Tutti i potenziamenti valgono globalmente. Rimborsi gratuiti tra le partite.", "解放した技術は全ランに適用されます。ラン間の払い戻しは無料です。", "해금한 모든 기술은 모든 판에 전역 적용됩니다. 판 사이 무료 환불.", "所有解锁的防御塔、打击与被动全局生效，局间免费重置。"],
  ["void.tech.fit", "Fit View", "Ajustar Vista", "Ajuster Vue", "Ansicht Einpassen", "Ajustar Vista", "Adatta Vista", "全体表示", "화면 맞춤", "适应视图"],
  ["void.tech.filter", "Filter", "Filtrar", "Filtrer", "Filter", "Filtrar", "Filtra", "絞込", "필터", "筛选"],
  ["void.tech.refundAll", "Refund All", "Reembolsar Todo", "Tout Rembourser", "Alles Erstatten", "Reembolsar Tudo", "Rimborsa Tutto", "全額返還", "전체 환불", "全部重置"],
  ["void.tech.sector", "Sector", "Sector", "Secteur", "Sektor", "Setor", "Settore", "セクター", "구역", "扇区"],
  ["void.tech.allSectors", "All 6 Sectors ({n} nodes)", "Los 6 Sectores ({n} nodos)", "6 Secteurs ({n} noeuds)", "Alle 6 Sektoren ({n} Knoten)", "Todos os 6 Setores ({n} nós)", "Tutti i 6 Settori ({n} nodi)", "全6セクター ({n}ノード)", "전체 6개 구역 ({n}노드)", "全部6个扇区 ({n}节点)"],
  ["void.tech.search", "Search tech...", "Buscar tecnología...", "Chercher techno...", "Technik suchen...", "Buscar tecnologia...", "Cerca tecnologia...", "技術を検索...", "기술 검색...", "搜索科技..."],
  ["void.tech.rank", "Rank", "Rango", "Rang", "Rang", "Nível", "Rango", "ランク", "등급", "等级"],
  ["void.tech.currency", "Currency", "Moneda", "Monnaie", "Währung", "Moeda", "Valuta", "通貨", "재화", "货币"],
  ["void.tech.requires", "Requires", "Requiere", "Requiert", "Benötigt", "Requer", "Richiede", "前提", "필요", "前置"],
  ["void.tech.lockedBattle", "Tech allocation is locked while an encounter is active.", "La asignación de tecnología está bloqueada durante un combate.", "L'allocation est verrouillée pendant un combat actif.", "Tech-Zuweisung ist während eines Gefechts gesperrt.", "Alocação bloqueada durante um combate ativo.", "Allocazione bloccata durante uno scontro attivo.", "戦闘中は技術割り当てがロックされます。", "전투 중에는 기술 할당이 잠깁니다.", "战斗进行期间锁定科技分配。"],
  ["void.tech.research", "Research Rank {r} ({cost} {curr})", "Investigar Rango {r} ({cost} {curr})", "Rechercher Rang {r} ({cost} {curr})", "Erforsche Rang {r} ({cost} {curr})", "Pesquisar Nível {r} ({cost} {curr})", "Ricerca Rango {r} ({cost} {curr})", "ランク{r}を研究 ({cost} {curr})", "등급 {r} 연구 ({cost} {curr})", "研究等级 {r} ({cost} {curr})"],
  ["void.tech.maxRank", "Max Rank Reached", "Rango Máximo Alcanzado", "Rang Maximum Atteint", "Maximalrang Erreicht", "Nível Máximo Atingido", "Rango Massimo Raggiunto", "最大ランク到達", "최대 등급 도달", "已达最高等级"],
  ["void.tech.refundNode", "Refund Node (Cascades Dependents)", "Reembolsar Nodo (en cascada)", "Rembourser Noeud (en cascade)", "Knoten Erstatten (Kaskade)", "Reembolsar Nó (em cascata)", "Rimborsa Nodo (a cascata)", "ノード返還（依存も返還）", "노드 환불 (하위 포함)", "重置节点（含关联后续）"],

  // Settings & Profile dialogs
  ["void.settings.title", "Command Settings", "Ajustes de Comando", "Paramètres", "Befehlseinstellungen", "Configurações", "Impostazioni", "コマンド設定", "명령 설정", "指挥设置"],
  ["void.settings.gameplay", "Gameplay", "Jugabilidad", "Jouabilité", "Spiel", "Jogabilidade", "Gioco", "ゲームプレイ", "게임플레이", "游戏玩法"],
  ["void.settings.audio", "Audio", "Audio", "Audio", "Audio", "Som", "Audio", "オーディオ", "오디오", "音频"],
  ["void.settings.display", "Display", "Pantalla", "Affichage", "Anzeige", "Exibição", "Schermo", "表示", "화면", "显示"],
  ["void.settings.language", "Language", "Idioma", "Langue", "Sprache", "Idioma", "Lingua", "言語", "언어", "语言"],
  ["void.settings.pauseOnBlur", "Pause & Mute When Unfocused", "Pausar y Silenciar sin Foco", "Pause et Muet Hors Focus", "Pause & Stumm ohne Fokus", "Pausar e Silenciar sem Foco", "Pausa e Muto Fuori Fuoco", "非アクティブ時に一時停止・消音", "비활성 시 일시정지 및 음소거", "失去焦点时暂停并静音"],
  ["void.settings.sound", "Audio & Sound Effects", "Audio y Efectos", "Audio et Effets", "Audio & Effekte", "Som e Efeitos", "Audio ed Effetti", "オーディオと効果音", "오디오 및 효과음", "音频与音效"],
  ["void.settings.master", "Master Volume", "Volumen Maestro", "Volume Principal", "Gesamtlautstärke", "Volume Principal", "Volume Principale", "マスター音量", "마스터 볼륨", "主音量"],
  ["void.settings.sfx", "SFX Volume", "Volumen SFX", "Volume SFX", "SFX-Lautstärke", "Volume SFX", "Volume SFX", "効果音音量", "효과음 볼륨", "音效音量"],
  ["void.settings.ambience", "Ambience Volume", "Volumen Ambiente", "Volume Ambiance", "Umgebungslautstärke", "Volume Ambiente", "Volume Ambiente", "環境音音量", "배경음 볼륨", "环境音量"],
  ["void.settings.music", "Music Volume", "Volumen Música", "Volume Musique", "Musiklautstärke", "Volume Música", "Volume Musica", "音楽音量", "음악 볼륨", "音乐音量"],
  ["void.settings.magnifier", "Precision Placement Magnifier", "Lupa de Colocación", "Loupe de Placement", "Platzierungslupe", "Lupa de Posicionamento", "Lente di Precisione", "精密配置ルーペ", "정밀 배치 돋보기", "精密放置放大镜"],
  ["void.settings.ringMenu", "Tower Controls Around Tower", "Controles Alrededor de la Torre", "Contrôles Autour de la Tour", "Turmsteuerung um den Turm", "Controles ao Redor da Torre", "Controlli Intorno alla Torre", "タワー周囲メニュー", "타워 주변 컨트롤", "防御塔环绕菜单"],
  ["void.settings.motion", "Reduce Motion & Ambient Flicker", "Reducir Movimiento", "Réduire les Animations", "Bewegung Reduzieren", "Reduzir Movimento", "Riduci Movimento", "モーション低減", "모션 줄이기", "减弱动态效果"],
  ["void.settings.pixelFont", "Custom Pixel Font (Alembic)", "Fuente Píxel (Alembic)", "Police Pixel (Alembic)", "Pixelschrift (Alembic)", "Fonte Pixel (Alembic)", "Font Pixel (Alembic)", "ピクセルフォント", "픽셀 글꼴 (Alembic)", "像素字体 (Alembic)"],
  ["void.settings.bheight", "Building Height", "Altura de Edificios", "Hauteur des Bâtiments", "Gebäudehöhe", "Altura dos Prédios", "Altezza Edifici", "建物の高さ", "건물 높이", "建筑高度"],
  ["void.settings.lquality", "Lighting Quality", "Calidad de Iluminación", "Qualité d'Éclairage", "Beleuchtungsqualität", "Qualidade da Iluminação", "Qualità Illuminazione", "ライティング品質", "조명 품질", "光照质量"],
  ["void.settings.tod", "Time of Day", "Hora del Día", "Heure du Jour", "Tageszeit", "Hora do Dia", "Ora del Giorno", "時間帯", "시간대", "时间段"],
  ["void.settings.done", "Done", "Listo", "Terminé", "Fertig", "Concluir", "Fatto", "完了", "완료", "完成"],
  ["void.profile.welcome", "Welcome, Commander", "Bienvenido, Comandante", "Bienvenue, Commandant", "Willkommen, Commander", "Bem-vindo, Comandante", "Benvenuto, Comandante", "ようこそ、司令官", "환영합니다, 사령관님", "欢迎，指挥官"],
  ["void.profile.edit", "Commander Profile", "Perfil de Comandante", "Profil de Commandant", "Commander-Profil", "Perfil de Comandante", "Profilo Comandante", "司令官プロフィール", "사령관 프로필", "指挥官档案"],
  ["void.profile.enter", "Enter Command", "Entrar al Mando", "Entrer en Commandement", "Kommando antreten", "Entrar no Comando", "Entra al Comando", "司令部へ入る", "지휘 시작", "进入指挥部"],
  ["void.profile.save", "Save Profile", "Guardar Perfil", "Enregistrer Profil", "Profil Speichern", "Salvar Perfil", "Salva Profilo", "プロフィール保存", "프로필 저장", "保存档案"],
] as const satisfies readonly TranslationRow[];
