export default {
  name: 'FinWiser',
  baseUrl: 'https://finwiser.net',
  goals: [
    'Navigate to the homepage and verify the page title contains "FinWiser", the hero headline is visible, and at least 2 calculator cards are shown',

    'Navigate to the Mortgage Calculator at /calculators/mortgage. Fill in a $400,000 home price, $80,000 down payment, 6.5% interest rate, and 30-year term. Calculate and verify a monthly payment is displayed and looks like a realistic dollar amount (between $1,000 and $5,000)',

    'Navigate to the Compound Interest Calculator at /calculators/compound-interest. Enter $10,000 principal, $200 monthly contribution, 7% rate, and 20 years. Verify a final balance is shown that is greater than the total amount contributed',

    'Navigate to the Debt Payoff Planner at /calculators/debt-payoff. Add a credit card debt with $5,000 balance, 22% APR, and $150 minimum payment. Calculate and verify a payoff date and total interest amount are displayed',

    'Navigate to the Loan Amortization calculator at /calculators/loan-amortization. Enter a $25,000 loan at 5% for 5 years. Calculate and verify the monthly payment is shown and the amortization table has rows',

    'Check that the navbar contains a Calculators dropdown, click it, and verify all 4 main calculators are listed (Mortgage, Loan Amortization, Compound Interest, Debt Payoff)',

    'Navigate to /privacy and verify the Privacy Policy page loads with visible content about data collection. Navigate to /terms and verify the Terms of Service page loads with visible content',
  ],
}
