// Умная вставка: проверяет через UI Automation, находится ли фокус в текстовом поле.
// Коды выхода: 0 — вставлено; 2 — фокус не в поле ввода (вставлять некуда); 1 — сбой.
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Text;

class PasteHelper
{
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT
    {
        public uint type;
        public KEYBDINPUT ki;
        public long padding; // выравнивание до размера union (MOUSEINPUT больше KEYBDINPUT)
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 2;
    const ushort VK_CONTROL = 0x11;
    const ushort VK_V = 0x56;

    static INPUT Key(ushort vk, bool up)
    {
        var input = new INPUT { type = INPUT_KEYBOARD };
        input.ki.wVk = vk;
        input.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
        return input;
    }

    /// Сколько последних символов вставленного текста ищем для проверки.
    const int TailLen = 24;
    /// Сколько ждём, пока приложение обработает Ctrl+V.
    const int VerifyTimeoutMs = 700;

    /// Заведомо непригодная цель: поле только для чтения. Проверяется ДО вставки.
    static bool FocusIsReadOnly(AutomationElement el)
    {
        try
        {
            object pattern;
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
            {
                // ValuePattern знает про режим только для чтения точно
                return ((ValuePattern)pattern).Current.IsReadOnly;
            }
            if (el.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return false;
            var type = el.Current.ControlType;
            return !(type == ControlType.Edit || type == ControlType.Document);
        }
        catch
        {
            return false; // не смогли определить — пробуем вставить
        }
    }

    /// Схлопывает пробелы, переводы строк и табуляции в один пробел.
    /// Хвост для проверки приходит уже схлопнутым (см. pasteTail в inserter.ts),
    /// а в поле текст лежит как есть — без этого многострочная вставка никогда
    /// не совпадала и показывалась карточка «вставить некуда».
    static string Flatten(string s)
    {
        var sb = new System.Text.StringBuilder(s.Length);
        bool space = false;
        foreach (char c in s)
        {
            if (char.IsWhiteSpace(c)) { space = true; continue; }
            if (space && sb.Length > 0) sb.Append(' ');
            space = false;
            sb.Append(c);
        }
        return sb.ToString();
    }

    /// Текст, в котором ищем след вставки. Пусто — проверить не удалось.
    static string TextBeforeCaret(AutomationElement el, int len)
    {
        try
        {
            object pattern;
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
            {
                // ValuePattern не знает про каретку: он отдаёт ВСЁ значение поля.
                // Раньше здесь брался только его конец — и вставка в начало или
                // середину непустого поля проверку не проходила, хотя удавалась.
                return ((ValuePattern)pattern).Current.Value ?? "";
            }
            if (el.TryGetCurrentPattern(TextPattern.Pattern, out pattern))
            {
                var tp = (TextPattern)pattern;
                var selection = tp.GetSelection();
                if (selection == null || selection.Length == 0) return "";
                var range = selection[0].Clone();
                range.MoveEndpointByUnit(TextPatternRangeEndpoint.Start, TextUnit.Character, -len);
                return range.GetText(len) ?? "";
            }
        }
        catch
        {
        }
        return "";
    }

    /// Появился ли наш текст там, где стоит каретка. Пустая строка = проверить нечем.
    static bool PasteLanded(AutomationElement el, string tail)
    {
        if (tail.Length == 0) return true;
        string needle = Flatten(tail);
        if (needle.Length == 0) return true;
        int waited = 0;
        bool checkable = false;
        while (waited < VerifyTimeoutMs)
        {
            string near = TextBeforeCaret(el, TailLen * 2);
            if (near.Length > 0)
            {
                checkable = true;
                // сравниваем обе стороны в одном виде: хвост приходит со
                // схлопнутыми пробелами, а поле отдаёт текст как есть
                if (Flatten(near).IndexOf(needle, StringComparison.Ordinal) >= 0) return true;
            }
            Thread.Sleep(70);
            waited += 70;
        }
        // проверить было нечем (приложение не отдаёт текст) — считаем, что вставилось:
        // лучше не показать карточку, чем показывать её на каждой удачной вставке
        return !checkable;
    }

    static int Main(string[] args)
    {
        Thread.Sleep(50); // дать буферу обмена устояться

        AutomationElement focused = null;
        try { focused = AutomationElement.FocusedElement; } catch { }
        if (focused == null) return 2;
        if (FocusIsReadOnly(focused)) return 2;

        var seq = new INPUT[]
        {
            Key(VK_CONTROL, false), Key(VK_V, false),
            Key(VK_V, true), Key(VK_CONTROL, true)
        };
        uint sent = SendInput((uint)seq.Length, seq, Marshal.SizeOf(typeof(INPUT)));
        if (sent != seq.Length) return 1;

        // хвост вставленного текста передаётся первым аргументом: по нему проверяем,
        // что текст действительно появился у каретки (страница браузера, просмотр
        // PDF и лента сообщений тоже «текстовые», но ввод не принимают)
        string tail = args.Length > 0 ? args[0] : "";
        return PasteLanded(focused, tail) ? 0 : 2;
    }
}
