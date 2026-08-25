/**
 * Russian.
 *
 * Keyed by the English source string; anything missing falls through to it.
 *
 * Written in the register a desktop uses rather than a manual: "Забыть сеть",
 * not "Осуществить удаление сохранённого профиля". Terms follow what GNOME and
 * KDE already ship in Russian, so the shell reads the same way as the
 * applications beside it.
 */
export const ru: Record<string, string> = {
  // -- control centre -------------------------------------------------------
  Internet: "Интернет",
  Bluetooth: "Bluetooth",
  Power: "Питание",
  "Screen Record": "Запись экрана",
  Screenshot: "Снимок экрана",
  Region: "Область",
  "Pick colour": "Пипетка",
  "To clipboard": "В буфер",
  Desktop: "Рабочий стол",
  Arrange: "Расставить",
  Arranging: "Расстановка",
  Notifications: "Уведомления",
  Silenced: "Без звука",
  None: "Нет",
  Off: "Выкл",
  On: "Вкл",
  Offline: "Нет сети",
  performance: "скорость",
  balanced: "баланс",
  "power saver": "энергосбережение",
  Wired: "Кабель",
  "Not connected": "Не подключено",
  "Volume mixer": "Микшер",
  "Mute microphone": "Выключить микрофон",
  Volume: "Громкость",
  Microphone: "Микрофон",
  Brightness: "Яркость",
  "Control center": "Центр управления",

  // -- session --------------------------------------------------------------
  Session: "Сеанс",
  Lock: "Заблокировать",
  "Log out": "Выйти",
  Suspend: "Сон",
  Restart: "Перезагрузка",
  "Power off": "Выключить",

  // -- network --------------------------------------------------------------
  "Wi-Fi": "Wi-Fi",
  Scan: "Поиск сетей",
  Scanning: "Идёт поиск",
  Connect: "Подключиться",
  Cancel: "Отмена",
  "Network name": "Имя сети",
  "Join a hidden network": "Подключиться к скрытой сети",
  "Forget this network": "Забыть эту сеть",
  "No Wi-Fi device": "Нет Wi-Fi адаптера",
  "Looking for networks…": "Поиск сетей…",
  "Turn on Wi-Fi to see networks": "Включите Wi-Fi, чтобы увидеть сети",
  "No Bluetooth adapter": "Нет Bluetooth адаптера",
  "Searching for devices…": "Поиск устройств…",
  "Turn on Bluetooth to see devices": "Включите Bluetooth, чтобы увидеть устройства",
  "Connecting…": "Подключение…",

  // -- mixer ----------------------------------------------------------------
  Output: "Вывод",
  Input: "Ввод",
  Applications: "Приложения",
  "Nothing is playing": "Ничего не играет",
  "No audio server": "Аудиосервер недоступен",

  // -- notifications --------------------------------------------------------
  Notification: "Уведомление",
  Dismiss: "Закрыть",
  "Do not disturb": "Не беспокоить",
  "Clear all": "Очистить всё",
  "No notifications": "Уведомлений нет",
  "just now": "только что",

  // -- launcher -------------------------------------------------------------
  "Search applications…": "Поиск приложений…",
  "No matches": "Ничего не найдено",
  "Press Enter to copy": "Enter — скопировать",
  "Run command": "Выполнить команду",
  "Pin to the top": "Закрепить наверху",
  Unpin: "Открепить",

  // -- clipboard ------------------------------------------------------------
  "Clipboard history": "История буфера",
  "Search clipboard…": "Поиск по буферу…",
  "Clipboard history is empty": "История буфера пуста",
  "Clear history": "Очистить историю",

  // -- calendar -------------------------------------------------------------
  "Back to today": "К сегодняшнему дню",

  // -- bar ------------------------------------------------------------------
  "Stop recording": "Остановить запись",
  "Show all": "Показать все",
  Back: "Назад",
  Clear: "Очистить",
  Mute: "Выключить звук",

  // -- weather --------------------------------------------------------------
  Clear_weather: "Ясно",
  "Partly cloudy": "Переменная облачность",
  Overcast: "Пасмурно",
  Fog: "Туман",
  Drizzle: "Морось",
  Rain: "Дождь",
  "Rain showers": "Ливень",
  Snow: "Снег",
  "Snow showers": "Снегопад",
  Thunderstorm: "Гроза",
  Today: "Сегодня",
  "No weather right now": "Погода недоступна",

  // -- desktop widgets ------------------------------------------------------
  Clock: "Часы",
  Date: "Дата",
  "Now playing": "Сейчас играет",
  "Drag to move · Scroll to resize · Right-click to align · Esc when done":
    "Тащить — переместить · Колесо — размер · Правый клик — выравнивание · Esc — готово",

  // -- privacy indicators ---------------------------------------------------
  "Microphone in use": "Микрофон используется",
  "Camera in use": "Камера используется",
  "Capturing the screen": "Идёт захват экрана",
}
