/**
 * Copyright 2020 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from 'fs';
import * as timers from 'timers';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as readline from 'readline';

declare const __dirname;

let aria = fs.readFileSync(path.join(__dirname, '../node_modules/aria-api/dist/aria.js'), { encoding: 'utf8' });

aria = aria.replace(`var childNodes = [];`, `var childNodes = Array.from(node.shadowRoot?.childNodes || []).filter(n => !getOwner(n) && !isHidden(n))`);

const ariaSelectorEngine = new Function('element', 'selector', `
  // Inject the aria library in case it has not been loaded yet
  if(!globalThis.aria) {${aria}}

  // Backslashes have to be escaped here 
  const m = /(?<role>\\w+)\\[(?<attribute>\\w+)(?<operator>=|\\*=)"(?<value>.+)"\\]/.exec(selector);
  if(!m) throw new Error('Invalid aria selector: ' + selector); 
  const [, role, attribute, operator, value] = m;
  if(attribute !== 'name') throw new Error('Only name is currently supported as an aria attribute.');

  const elements = [];
  const collect = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    do {
      const currentNode = walker.currentNode;
      if (currentNode.shadowRoot) {
        collect(currentNode.shadowRoot);
      }
      // We're only interested in actual elements that we can later use for selector
      // matching, so skip shadow roots.
      if (!(currentNode instanceof ShadowRoot)) {
        elements.push(currentNode);
      }
    } while (walker.nextNode());
  };

  collect(document.body);

  for(const element of elements) {
    if(!element.parentElement) continue;
    if(aria.getRole(element) !== role) continue;
    const name = aria.getName(element);
    if(operator === '*=' && name.includes(value)) {
      return element;
    } else if(name === value) {
      return element;
    }
  }

  return null;
`);

puppeteer.__experimental_registerCustomQueryHandler('aria', ariaSelectorEngine);

const timeout = t => new Promise(cb => timers.setTimeout(cb, t));

let browser, page;
let delay = 100;
const debug = process.env.DEBUG;

interface RunnerOptions {
  delay: number
}

async function beforeStep(...args) {
  console.log(...args);

  if(!debug) {
    await timeout(delay);
    return;
  }
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise(resolve => rl.question('Press enter to execute this step?', ans => {
    rl.close();
    resolve(ans);
  }));
}

export async function open(url, options: RunnerOptions, cb) {
  delay = options.delay || 100;
  browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const pages = await browser.pages();
  page = pages[0];
  await page.evaluateOnNewDocument(aria);
  await page.goto(url);
  await timeout(1000);
  await cb(page, browser);
  await browser.close();
}

export async function click(selector) {
  await beforeStep('click', selector);
  const element = await page.waitForSelector(selector);
  await element.click();
}

export async function type(selector, value) {
  await beforeStep('type', selector, value);
  const element = await page.waitForSelector(selector);
  await element.click({ clickCount: 3 });
  await element.press('Backspace');
  await element.type(value);
}

export async function submit(selector) {
  await beforeStep('submit', selector);
  await page.$eval(selector, form => form.requestSubmit());
}
