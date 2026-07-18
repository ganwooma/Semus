const { test, expect } = require('@playwright/test');
const path = require('path');
test('모의 홈택스 발급 화면 흐름', async ({ page }) => {
  await page.goto(`file:///${path.resolve(__dirname, '../src/mock-hometax/index.html').replace(/\\/g, '/')}`);
  await page.getByRole('button', { name: '전자세금계산서 발급하기' }).click();
  await page.getByLabel('공급받는 분 사업자등록번호').fill('123-45-67890');
  await page.getByRole('button', { name: '내용 확인하기' }).click();
  await page.getByRole('button', { name: '발급 완료' }).click();
  await expect(page.getByText('발급이 완료되었습니다')).toBeVisible();
});
