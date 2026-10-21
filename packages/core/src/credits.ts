/**
 * Благодарности и лицензии открытого кода, на котором собран offix.
 * Один список на сайт и приложение: страница «Лицензии» строится из него,
 * а тест проверяет, что у каждой библиотеки есть полный текст лицензии
 * с её копирайтом (этого требуют MIT, ISC и OFL).
 */

export type LicenseId = 'MIT' | 'ISC' | 'OFL-1.1';

export type CreditPlatform = 'web' | 'mobile';

export interface Credit {
  /** Пакет или проект, как его называют авторы. */
  name: string;
  /** Чем он помог offix, одной фразой. */
  role: string;
  url: string;
  license: LicenseId;
  /** Строка копирайта ровно как в файле лицензии проекта. */
  copyright: string;
  platforms: CreditPlatform[];
  /** Главные визуальные библиотеки — их показываем в подвале каждой страницы. */
  featured?: boolean;
}

export const CREDITS: Credit[] = [
  {
    name: 'React Three Fiber',
    role: '3D-сцена со знаком offix на главной и в приложении',
    url: 'https://github.com/pmndrs/react-three-fiber',
    license: 'MIT',
    copyright: 'Copyright (c) 2019-2025 Poimandres',
    platforms: ['web', 'mobile'],
    featured: true,
  },
  {
    name: 'liquid-glass-react',
    role: 'Жидкое стекло: навигация, карточки и нижняя панель сайта',
    url: 'https://github.com/rdev/liquid-glass-react',
    license: 'MIT',
    copyright: 'Copyright 2025 MAX ROVENSKY',
    platforms: ['web'],
    featured: true,
  },
  {
    name: 'ShaderGradient',
    role: 'Живой градиент первого экрана и страницы входа',
    url: 'https://github.com/ruucm/shadergradient',
    license: 'MIT',
    copyright: 'Copyright (c) ruucm, stone-skipper',
    platforms: ['web'],
    featured: true,
  },
  {
    name: 'three.js',
    role: 'WebGL-движок под 3D и градиентом',
    url: 'https://github.com/mrdoob/three.js',
    license: 'MIT',
    copyright: 'Copyright © 2010-2026 three.js authors',
    platforms: ['web', 'mobile'],
    featured: true,
  },
  {
    name: 'drei',
    role: 'Стеклянный материал и плавающая анимация 3D-знака',
    url: 'https://github.com/pmndrs/drei',
    license: 'MIT',
    copyright: 'Copyright (c) 2020 react-spring',
    platforms: ['web'],
  },
  {
    name: 'React',
    role: 'Интерфейс сайта и приложения',
    url: 'https://github.com/facebook/react',
    license: 'MIT',
    copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.',
    platforms: ['web', 'mobile'],
  },
  {
    name: 'React Router',
    role: 'Навигация сайта',
    url: 'https://github.com/remix-run/react-router',
    license: 'MIT',
    copyright: 'Copyright (c) React Training LLC 2015-2019\nCopyright (c) Remix Software Inc. 2020-2021',
    platforms: ['web'],
  },
  {
    name: 'TanStack Query',
    role: 'Загрузка и кэш данных',
    url: 'https://github.com/TanStack/query',
    license: 'MIT',
    copyright: 'Copyright (c) 2021-present Tanner Linsley',
    platforms: ['web', 'mobile'],
  },
  {
    name: 'Expo',
    role: 'Приложение для iOS и Android, жидкое стекло и размытие на телефоне',
    url: 'https://github.com/expo/expo',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)',
    platforms: ['mobile'],
  },
  {
    name: 'Lucide',
    role: 'Иконки',
    url: 'https://github.com/lucide-icons/lucide',
    license: 'ISC',
    copyright: 'Copyright (c) 2026 Lucide Icons and Contributors',
    platforms: ['web', 'mobile'],
  },
  {
    name: 'Onest',
    role: 'Шрифт интерфейса',
    url: 'https://github.com/simpals/onest',
    license: 'OFL-1.1',
    copyright: 'Copyright 2021 The Onest Project Authors (https://github.com/simpals/onest)',
    platforms: ['web', 'mobile'],
  },
];

export const LICENSE_NAMES: Record<LicenseId, string> = {
  MIT: 'MIT License',
  ISC: 'ISC License',
  'OFL-1.1': 'SIL Open Font License 1.1',
};

const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const ISC = `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

const OFL = `-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.`;

/** Полный текст лицензии с копирайтом проекта — то, что нужно показать вместе с кодом. */
export function licenseText(credit: Credit): string {
  switch (credit.license) {
    case 'MIT':
      return `MIT License\n\n${credit.copyright}\n\n${MIT}`;
    case 'ISC':
      return `ISC License\n\n${credit.copyright}\n\n${ISC}`;
    case 'OFL-1.1':
      return `${credit.copyright}\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\n\n${OFL}`;
  }
}

/** Библиотеки конкретной платформы; главные визуальные — первыми, дальше как в списке. */
export function creditsFor(platform: CreditPlatform): Credit[] {
  const list = CREDITS.filter((c) => c.platforms.includes(platform));
  return [...list.filter((c) => c.featured), ...list.filter((c) => !c.featured)];
}
