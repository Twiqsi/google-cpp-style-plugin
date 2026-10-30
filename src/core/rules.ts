// Описание всех правил: название, важность по умолчанию, ссылка на раздел
// Google C++ Style Guide, объяснение и пример «плохо / хорошо».
// Эти тексты показываются во всплывающей подсказке при наведении.

import { Severity } from './types';

export const GUIDE_URL = 'https://google.github.io/styleguide/cppguide.html';

export interface RuleInfo {
  title: string;
  category: 'Форматирование' | 'Пробелы' | 'Именование' | 'Заголовки' | 'Возможности C++' | 'Комментарии';
  /** undefined — использовать важность по умолчанию из настроек. */
  severity?: Severity;
  anchor: string;
  explain: string;
  bad: string;
  good: string;
}

export const RULES: Record<string, RuleInfo> = {
  // ───────────── Форматирование ─────────────
  'indentation': {
    title: 'Отступы',
    category: 'Форматирование',
    anchor: 'Spaces_vs._Tabs',
    explain:
      'Каждый уровень вложенности сдвигается на заданное число пробелов (по Google — 2, ' +
      'размер меняется в настройках). Содержимое namespace не сдвигается, `public:`/`private:` ' +
      'сдвигаются на 1 пробел, `case` — на один уровень внутри `switch`, а код под `case` — ещё на один. ' +
      'Перенесённые строки (продолжения) должны быть сдвинуты сильнее начала инструкции.',
    bad: 'void F() {\n    int x = 0;\n}',
    good: 'void F() {\n  int x = 0;\n}',
  },
  'tab': {
    title: 'Табуляция',
    category: 'Форматирование',
    anchor: 'Spaces_vs._Tabs',
    explain: 'Используйте только пробелы. Символы табуляции запрещены — настройте редактор так, чтобы Tab вставлял пробелы.',
    bad: 'if (x) {\n\treturn;\n}',
    good: 'if (x) {\n  return;\n}',
  },
  'line-length': {
    title: 'Длина строки',
    category: 'Форматирование',
    anchor: 'Line_Length',
    explain:
      'Строка должна быть не длиннее заданного лимита (по Google — 80 символов). Исключения: ' +
      '#include, header guard, using-объявления и комментарии со ссылкой, которую нельзя разорвать.',
    bad: 'int result = CalculateSomething(first_argument, second_argument, third_argument);',
    good: 'int result = CalculateSomething(first_argument, second_argument,\n                                 third_argument);',
  },
  'trailing-whitespace': {
    title: 'Пробелы в конце строки',
    category: 'Форматирование',
    anchor: 'Horizontal_Whitespace',
    explain: 'В конце строки не должно быть пробелов и табуляций.',
    bad: 'int x = 0;␣␣',
    good: 'int x = 0;',
  },
  'end-of-file': {
    title: 'Конец файла',
    category: 'Форматирование',
    anchor: 'Vertical_Whitespace',
    explain: 'Файл должен заканчиваться ровно одним переводом строки, без пустых строк в конце.',
    bad: '}  // namespace foo⏎⏎⏎',
    good: '}  // namespace foo⏎',
  },
  'blank-lines': {
    title: 'Пустые строки',
    category: 'Форматирование',
    anchor: 'Vertical_Whitespace',
    explain:
      'Пустые строки используйте экономно: не ставьте их в начале и в конце блока, ' +
      'не ставьте несколько подряд и не оставляйте пустую строку сразу после `public:`/`private:`.',
    bad: 'void F() {\n\n  DoSomething();\n\n}',
    good: 'void F() {\n  DoSomething();\n}',
  },
  'access-specifier-blank-line': {
    title: 'Пустая строка перед public/private',
    category: 'Форматирование',
    severity: 'info',
    anchor: 'Class_Format',
    explain: 'Перед `public:`, `protected:` и `private:` (кроме первого в классе) ставится пустая строка. В маленьких классах это необязательно.',
    bad: 'class Foo {\n public:\n  Foo();\n private:\n  int x_;\n};',
    good: 'class Foo {\n public:\n  Foo();\n\n private:\n  int x_;\n};',
  },
  'preprocessor-indent': {
    title: 'Директивы препроцессора',
    category: 'Форматирование',
    anchor: 'Preprocessor_Directives',
    explain: 'Символ `#` всегда стоит в начале строки, даже внутри функций. Отступ можно ставить после `#`.',
    bad: '  if (x) {\n    #ifdef DEBUG\n    Log();\n    #endif\n  }',
    good: '  if (x) {\n#ifdef DEBUG\n    Log();\n#endif\n  }',
  },
  'brace-same-line': {
    title: 'Открывающая скобка `{`',
    category: 'Форматирование',
    anchor: 'Function_Declarations_and_Definitions',
    explain: 'Открывающая фигурная скобка ставится в конце строки с объявлением/условием, а не на отдельной строке.',
    bad: 'void F()\n{\n  ...\n}',
    good: 'void F() {\n  ...\n}',
  },
  'else-same-line': {
    title: '`else` на одной строке с `}`',
    category: 'Форматирование',
    anchor: 'Formatting_Looping_Branching',
    explain: '`else` (и `catch`) пишутся на той же строке, что и закрывающая `}` предыдущего блока.',
    bad: 'if (x) {\n  A();\n}\nelse {\n  B();\n}',
    good: 'if (x) {\n  A();\n} else {\n  B();\n}',
  },
  'braces-if-else': {
    title: 'Скобки в if-else',
    category: 'Форматирование',
    anchor: 'Formatting_Looping_Branching',
    explain:
      'Без фигурных скобок можно писать только короткий одиночный if/for/while. ' +
      'Если есть `else` — фигурные скобки обязательны во всех ветках.',
    bad: 'if (x) DoThis();\nelse DoThat();',
    good: 'if (x) {\n  DoThis();\n} else {\n  DoThat();\n}',
  },
  'empty-loop-body': {
    title: 'Пустое тело цикла',
    category: 'Форматирование',
    anchor: 'Formatting_Looping_Branching',
    explain: 'Пустое тело цикла пишется как `{}` или `continue;`, а не одиночной `;` — её легко спутать с do-while.',
    bad: 'while (condition);',
    good: 'while (condition) {}',
  },
  'namespace-end-comment': {
    title: 'Комментарий в конце namespace',
    category: 'Форматирование',
    anchor: 'Namespaces',
    explain: 'Многострочный namespace закрывается комментарием с его именем.',
    bad: 'namespace lab {\n...\n}',
    good: 'namespace lab {\n...\n}  // namespace lab',
  },
  'one-statement-per-line': {
    title: 'Одна инструкция на строке',
    category: 'Форматирование',
    anchor: 'Vertical_Whitespace',
    explain: 'Не пишите несколько инструкций в одной строке — каждая на своей строке.',
    bad: 'a = 1; b = 2;',
    good: 'a = 1;\nb = 2;',
  },
  'function-length': {
    title: 'Длинная функция',
    category: 'Форматирование',
    severity: 'info',
    anchor: 'Write_Short_Functions',
    explain:
      'Google рекомендует короткие функции: если функция длиннее ~40 строк, подумайте, ' +
      'нельзя ли разбить её на части. Лимит настраивается.',
    bad: 'void Solve() {\n  // 120 строк кода\n}',
    good: 'void Solve() {\n  ReadInput();\n  Compute();\n  PrintAnswer();\n}',
  },
  'switch-default': {
    title: '`default` в switch',
    category: 'Форматирование',
    severity: 'info',
    anchor: 'Switch_Statements',
    explain: 'Если switch не по enum, в нём всегда должна быть ветка `default`.',
    bad: 'switch (x) {\n  case 1:\n    A();\n    break;\n}',
    good: 'switch (x) {\n  case 1:\n    A();\n    break;\n  default:\n    break;\n}',
  },

  // ───────────── Пробелы ─────────────
  'space-after-keyword': {
    title: 'Пробел после if/for/while',
    category: 'Пробелы',
    anchor: 'Formatting_Looping_Branching',
    explain: 'После `if`, `for`, `while`, `switch`, `catch` ставится пробел перед `(`.',
    bad: 'if(x) {',
    good: 'if (x) {',
  },
  'space-before-brace': {
    title: 'Пробел перед `{`',
    category: 'Пробелы',
    anchor: 'Horizontal_Whitespace',
    explain: 'Перед открывающей фигурной скобкой блока всегда ставится пробел.',
    bad: 'if (x){\n} else{',
    good: 'if (x) {\n} else {',
  },
  'paren-spacing': {
    title: 'Пробелы внутри скобок',
    category: 'Пробелы',
    anchor: 'Formatting_Looping_Branching',
    explain: 'Внутри круглых скобок не ставят пробелы сразу после `(` и перед `)`.',
    bad: 'if ( x > 0 ) {\nFoo( a, b );',
    good: 'if (x > 0) {\nFoo(a, b);',
  },
  'function-call-space': {
    title: 'Пробел перед `(` вызова',
    category: 'Пробелы',
    anchor: 'Function_Declarations_and_Definitions',
    explain: 'Между именем функции и открывающей скобкой пробела нет — ни в вызове, ни в объявлении.',
    bad: 'void Print (int x);\nPrint (5);',
    good: 'void Print(int x);\nPrint(5);',
  },
  'operator-spacing': {
    title: 'Пробелы вокруг операторов',
    category: 'Пробелы',
    anchor: 'Horizontal_Whitespace',
    explain:
      'Операторы присваивания (`=`, `+=`, ...) всегда окружены пробелами. ' +
      'Сравнения (`==`, `!=`, `<=`, `>=`) и логические (`&&`, `||`) тоже пишутся с пробелами.',
    bad: 'x=a+b;\nif (a==b&&c!=d)',
    good: 'x = a + b;\nif (a == b && c != d)',
  },
  'comma-spacing': {
    title: 'Пробел после запятой',
    category: 'Пробелы',
    anchor: 'Horizontal_Whitespace',
    explain: 'После запятой ставится пробел, перед запятой — нет.',
    bad: 'Foo(a,b ,c);',
    good: 'Foo(a, b, c);',
  },
  'semicolon-spacing': {
    title: 'Пробелы у `;`',
    category: 'Пробелы',
    anchor: 'Formatting_Looping_Branching',
    explain: 'Перед `;` пробела нет, после `;` внутри `for (...)` — есть.',
    bad: 'for (int i = 0;i < n;++i) {\nx = 1 ;',
    good: 'for (int i = 0; i < n; ++i) {\nx = 1;',
  },
  'range-for-colon': {
    title: 'Двоеточие в range-for',
    category: 'Пробелы',
    anchor: 'Horizontal_Whitespace',
    explain: 'В range-based for вокруг `:` ставятся пробелы с обеих сторон.',
    bad: 'for (int x: values) {',
    good: 'for (int x : values) {',
  },
  'template-space': {
    title: 'Пробел после template',
    category: 'Пробелы',
    anchor: 'Horizontal_Whitespace',
    explain: 'Между `template` и `<` ставится пробел.',
    bad: 'template<typename T>',
    good: 'template <typename T>',
  },
  'pointer-alignment': {
    title: 'Положение `*` и `&`',
    category: 'Пробелы',
    anchor: 'Pointer_and_Reference_Expressions',
    explain:
      'В объявлениях `*` и `&` прижимаются к типу, а от имени отделяются пробелом: `char* c`, ' +
      '`const std::string& s`. Нельзя объявлять несколько переменных в одной строке, если среди них есть указатель или ссылка.',
    bad: 'int *p;\nchar * c;\nint *a, *b;',
    good: 'int* p;\nchar* c;\nint* a;\nint* b;',
  },

  // ───────────── Комментарии ─────────────
  'comment-spacing': {
    title: 'Оформление комментариев',
    category: 'Комментарии',
    anchor: 'Horizontal_Whitespace',
    explain: 'После `//` ставится пробел. Перед комментарием в конце строки кода — минимум два пробела.',
    bad: 'int x = 0; //счётчик',
    good: 'int x = 0;  // счётчик',
  },
  'todo-format': {
    title: 'Формат TODO',
    category: 'Комментарии',
    anchor: 'TODO_Comments',
    explain: 'TODO пишется заглавными и с указанием автора или задачи в скобках: `// TODO(имя): что сделать`.',
    bad: '// todo: переделать\n// TODO переделать',
    good: '// TODO(vladimir): переделать на двоичный поиск.',
  },
  'copyright': {
    title: 'Лицензия в начале файла',
    category: 'Комментарии',
    severity: 'off',
    anchor: 'File_Comments',
    explain: 'Каждый файл начинается с комментария с лицензией/авторством. По умолчанию правило выключено.',
    bad: '#include <iostream>',
    good: '// Copyright 2026 Имя Фамилия\n\n#include <iostream>',
  },

  // ───────────── Именование ─────────────
  'naming-type': {
    title: 'Имена типов',
    category: 'Именование',
    anchor: 'Type_Names',
    explain: 'Классы, структуры, enum, typedef и using-псевдонимы называются в PascalCase: каждое слово с заглавной буквы, без подчёркиваний.',
    bad: 'class big_integer;\nstruct point_2d;',
    good: 'class BigInteger;\nstruct Point2d;',
  },
  'naming-function': {
    title: 'Имена функций',
    category: 'Именование',
    anchor: 'Function_Names',
    explain:
      'Функции называются в PascalCase: `AddTableEntry()`. Исключение — геттеры и сеттеры, ' +
      'их можно называть как переменные: `int count() const`, `void set_count(int count)`.',
    bad: 'void print_array();\nint calcSum(int a, int b);',
    good: 'void PrintArray();\nint CalcSum(int a, int b);',
  },
  'naming-variable': {
    title: 'Имена переменных',
    category: 'Именование',
    anchor: 'Variable_Names',
    explain: 'Переменные и параметры функций — в snake_case: строчные буквы, слова через подчёркивание.',
    bad: 'int itemCount;\nstd::string TableName;',
    good: 'int item_count;\nstd::string table_name;',
  },
  'naming-member': {
    title: 'Имена полей класса',
    category: 'Именование',
    anchor: 'Variable_Names',
    explain:
      'Поля `class` — в snake_case с подчёркиванием в конце: `table_name_`. ' +
      'Поля `struct` — в snake_case без подчёркивания в конце.',
    bad: 'class Table {\n  int rowCount;\n  int m_size;\n};',
    good: 'class Table {\n  int row_count_;\n  int size_;\n};',
  },
  'naming-constant': {
    title: 'Имена констант',
    category: 'Именование',
    anchor: 'Constant_Names',
    explain:
      'Константы (`const`/`constexpr` со статическим временем жизни: глобальные, в namespace, ' +
      '`static` поля класса) называются с `k` и PascalCase: `kDaysInAWeek`.',
    bad: 'const int MAX_SIZE = 100;\nconstexpr double pi = 3.14;',
    good: 'const int kMaxSize = 100;\nconstexpr double kPi = 3.14;',
  },
  'naming-enumerator': {
    title: 'Имена значений enum',
    category: 'Именование',
    anchor: 'Enumerator_Names',
    explain: 'Значения enum называются как константы — `kEnumName`, а не как макросы `ENUM_NAME`.',
    bad: 'enum class Color { RED, GREEN };',
    good: 'enum class Color { kRed, kGreen };',
  },
  'naming-namespace': {
    title: 'Имена namespace',
    category: 'Именование',
    anchor: 'Namespace_Names',
    explain: 'Имена пространств имён — в snake_case (строчные буквы и подчёркивания).',
    bad: 'namespace MyLab {',
    good: 'namespace my_lab {',
  },
  'naming-macro': {
    title: 'Имена макросов',
    category: 'Именование',
    anchor: 'Macro_Names',
    explain: 'Макросы называются ЗАГЛАВНЫМИ_БУКВАМИ_С_ПОДЧЁРКИВАНИЯМИ. А лучше вообще обходиться без них.',
    bad: '#define maxValue 100',
    good: '#define MAX_VALUE 100  // а лучше: constexpr int kMaxValue = 100;',
  },
  'naming-template-param': {
    title: 'Имена параметров шаблона',
    category: 'Именование',
    anchor: 'Template_Parameter_Names',
    explain: 'Типовые параметры шаблона называются как типы — в PascalCase (`T`, `ValueType`).',
    bad: 'template <typename value_type>',
    good: 'template <typename ValueType>',
  },

  // ───────────── Заголовки и include ─────────────
  'header-guard': {
    title: 'Header guard',
    category: 'Заголовки',
    anchor: 'The__define_Guard',
    explain:
      'Каждый заголовочный файл защищается от повторного включения через `#ifndef` / `#define` / `#endif` ' +
      'с именем вида `<ПУТЬ>_<ФАЙЛ>_H_`. `#pragma once` в Google не используется.',
    bad: '#pragma once\n\nclass Foo {};',
    good: '#ifndef LAB_FOO_H_\n#define LAB_FOO_H_\n\nclass Foo {};\n\n#endif  // LAB_FOO_H_',
  },
  'include-order': {
    title: 'Порядок #include',
    category: 'Заголовки',
    anchor: 'Names_and_Order_of_Includes',
    explain:
      'Порядок: свой заголовок → системные C-заголовки (`<stdio.h>`) → стандартная библиотека C++ (`<vector>`) → ' +
      'другие библиотеки → заголовки проекта (`"..."`). Группы разделяются пустой строкой, внутри группы — по алфавиту. ' +
      'Не используйте `.` и `..` в путях.',
    bad: '#include "my.h"\n#include <vector>\n#include <iostream>',
    good: '#include <iostream>\n#include <vector>\n\n#include "my.h"',
  },
  'include-bits': {
    title: '<bits/stdc++.h>',
    category: 'Заголовки',
    anchor: 'Include_What_You_Use',
    explain: '`<bits/stdc++.h>` — нестандартный заголовок GCC. Подключайте только то, что используете (`<iostream>`, `<vector>`, ...).',
    bad: '#include <bits/stdc++.h>',
    good: '#include <iostream>\n#include <vector>',
  },

  // ───────────── Возможности C++ ─────────────
  'using-namespace': {
    title: 'using namespace',
    category: 'Возможности C++',
    anchor: 'Namespaces',
    explain: '`using namespace ...;` запрещён: он засоряет пространство имён. Пишите `std::` явно или `using std::cout;`.',
    bad: 'using namespace std;',
    good: 'std::cout << x;\n// или: using std::cout;',
  },
  'namespace-std': {
    title: 'Объявления в namespace std',
    category: 'Возможности C++',
    anchor: 'Namespaces',
    explain: 'Ничего не объявляйте в `namespace std` — это неопределённое поведение.',
    bad: 'namespace std {\nclass MyType;\n}',
    good: '#include <string>  // подключите нужный заголовок',
  },
  'c-style-cast': {
    title: 'C-style приведение типов',
    category: 'Возможности C++',
    anchor: 'Casting',
    explain:
      'Не используйте приведения вида `(int)x`. Используйте `static_cast<int>(x)` ' +
      '(или `reinterpret_cast`/`const_cast` для указателей). Исключение — приведение к `(void)`.',
    bad: 'double avg = (double)sum / n;',
    good: 'double avg = static_cast<double>(sum) / n;',
  },
  'nullptr': {
    title: 'NULL вместо nullptr',
    category: 'Возможности C++',
    anchor: '0_and_nullptr/NULL',
    explain: 'Для указателей используйте `nullptr`, а не `NULL` или `0`.',
    bad: 'Node* head = NULL;',
    good: 'Node* head = nullptr;',
  },
  'integer-types': {
    title: 'Целочисленные типы',
    category: 'Возможности C++',
    anchor: 'Integer_Types',
    explain:
      'Из встроенных целых типов используется только `int`. Если нужен другой размер — ' +
      'берите типы из `<cstdint>`: `int16_t`, `int64_t`, `uint64_t` и т.д. вместо `short`, `long`, `long long`.',
    bad: 'long long total = 0;\nunsigned short port;',
    good: 'int64_t total = 0;\nuint16_t port;',
  },
  'explicit-constructor': {
    title: 'explicit-конструктор',
    category: 'Возможности C++',
    anchor: 'Explicit_Constructors',
    explain:
      'Конструктор, который можно вызвать с одним аргументом, помечается `explicit`, ' +
      'чтобы не было неявных преобразований. Исключения: копирующий/перемещающий конструктор и `std::initializer_list`.',
    bad: 'class Number {\n public:\n  Number(int value);\n};',
    good: 'class Number {\n public:\n  explicit Number(int value);\n};',
  },
  'virtual-override': {
    title: 'virtual вместе с override',
    category: 'Возможности C++',
    anchor: 'Inheritance',
    explain: 'При переопределении пишите ровно одно из `override` или `final`, без `virtual`.',
    bad: 'virtual void Draw() override;',
    good: 'void Draw() override;',
  },
  'return-parens': {
    title: 'Скобки в return',
    category: 'Возможности C++',
    anchor: 'Return_Values',
    explain: 'Не оборачивайте всё выражение в return в лишние скобки: `return` — не функция.',
    bad: 'return (result);\nreturn(x + y);',
    good: 'return result;\nreturn x + y;',
  },
  'preincrement': {
    title: 'Префиксный ++/--',
    category: 'Возможности C++',
    severity: 'info',
    anchor: 'Preincrement_and_Predecrement',
    explain: 'Используйте префиксную форму `++i`/`--i`, если результат постфиксной формы не нужен.',
    bad: 'for (int i = 0; i < n; i++) {\ncount++;',
    good: 'for (int i = 0; i < n; ++i) {\n++count;',
  },
  'global-object': {
    title: 'Глобальные объекты',
    category: 'Возможности C++',
    anchor: 'Static_and_Global_Variables',
    explain:
      'Глобальные и статические объекты с нетривиальным деструктором (`std::string`, `std::vector`, `std::map`...) запрещены. ' +
      'Используйте `constexpr`, `const char[]`, `std::string_view` или локальные переменные.',
    bad: 'std::string kGreeting = "hello";',
    good: 'constexpr char kGreeting[] = "hello";',
  },
  'macro-constant': {
    title: 'Макрос-константа',
    category: 'Возможности C++',
    severity: 'info',
    anchor: 'Preprocessor_Macros',
    explain: 'Избегайте макросов. Вместо `#define N 100` используйте `constexpr int kN = 100;`.',
    bad: '#define MAX_N 100000',
    good: 'constexpr int kMaxN = 100000;',
  },
  'exceptions': {
    title: 'Исключения',
    category: 'Возможности C++',
    severity: 'info',
    anchor: 'Exceptions',
    explain: 'В коде Google исключения C++ не используются. Если преподаватель требует исключения — отключите это правило.',
    bad: 'throw std::runtime_error("bad input");',
    good: 'return false;  // или код ошибки / std::optional',
  },
  'rtti': {
    title: 'RTTI',
    category: 'Возможности C++',
    severity: 'info',
    anchor: 'Run-Time_Type_Information__RTTI_',
    explain: 'Избегайте `dynamic_cast` и `typeid` — обычно лучше виртуальные функции.',
    bad: 'if (auto* c = dynamic_cast<Circle*>(shape)) {',
    good: 'shape->Draw();',
  },
};

export function ruleUrl(rule: string): string {
  const info = RULES[rule];
  return info ? `${GUIDE_URL}#${info.anchor}` : GUIDE_URL;
}
