import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { CreateAccount } from '../../application/use-cases/accounts/create-account.use-case';
import { CreateMovement } from '../../application/use-cases/accounts/create-movement.use-case';
import { CreateTransfer } from '../../application/use-cases/accounts/create-transfer.use-case';
import { GetAccount } from '../../application/use-cases/accounts/get-account.use-case';
import { GetAccountBalance } from '../../application/use-cases/accounts/get-account-balance.use-case';
import { GetAccountLedger } from '../../application/use-cases/accounts/get-account-ledger.use-case';
import { ListAccountPartners } from '../../application/use-cases/accounts/list-account-partners.use-case';
import { ListAccounts } from '../../application/use-cases/accounts/list-accounts.use-case';
import { ReconcileAccount } from '../../application/use-cases/accounts/reconcile-account.use-case';
import { UpdateAccount } from '../../application/use-cases/accounts/update-account.use-case';
import {
  AccountBalanceQueryDto,
  AccountBalanceResponseDto,
  AccountIdParamsDto,
  AccountLedgerQueryDto,
  AccountLedgerResponseDto,
  AccountListResponseDto,
  AccountPartnerResponseDto,
  AccountResponseDto,
  CreateAccountDto,
  CreateMovementDto,
  CreateTransferDto,
  ListAccountsQueryDto,
  MovementResponseDto,
  ReconcileAccountDto,
  ReconciliationResponseDto,
  TransferResponseDto,
  UpdateAccountDto,
  toAccountResponse,
  toBalanceResponse,
  toLedgerRowResponse,
  toMovementResponse,
  toPartnerResponse,
  toReconciliationResponse,
  toTransferResponse,
} from './dto/accounts.dto';

/**
 * Company accounts (PRD §8.7, §9.7): Owner and Admin only (Member and Viewer get `FORBIDDEN`, PRD §4.3).
 * Every route declares its grant (C13) and the use case runs `can()` as the authority. `partners` is
 * declared before the `:id` routes. Accounts are deactivated, never archived (Q-BE3-4).
 */
@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly listAccounts: ListAccounts,
    private readonly listPartners: ListAccountPartners,
    private readonly getAccount: GetAccount,
    private readonly createAccount: CreateAccount,
    private readonly updateAccount: UpdateAccount,
    private readonly getLedger: GetAccountLedger,
    private readonly getBalance: GetAccountBalance,
    private readonly reconcileAccount: ReconcileAccount,
    private readonly createMovement: CreateMovement,
  ) {}

  @Get()
  @RequiresGrant('account', 'read')
  @ApiOperation({
    operationId: 'listAccounts',
    summary: 'List accounts with their balances (inactive ones only on request)',
  })
  @ApiOkResponse({ type: AccountListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListAccountsQueryDto,
  ): Promise<AccountListResponseDto> {
    const page = await this.listAccounts.execute(user, query);
    return { ...page, items: page.items.map(toAccountResponse) };
  }

  @Get('partners')
  @RequiresGrant('account', 'read')
  @ApiOperation({
    operationId: 'listAccountPartners',
    summary: 'Users who can be the partner of a contribution or withdrawal',
  })
  @ApiOkResponse({ type: [AccountPartnerResponseDto] })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'INTERNAL')
  async partners(@CurrentUser() user: CurrentUserModel): Promise<AccountPartnerResponseDto[]> {
    return (await this.listPartners.execute(user)).map(toPartnerResponse);
  }

  @Post()
  @RequiresGrant('account', 'create')
  @ApiOperation({ operationId: 'createAccount', summary: 'Open a company account' })
  @ApiBody({ type: CreateAccountDto })
  @ApiCreatedResponse({ type: AccountResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    return toAccountResponse(await this.createAccount.execute(user, body));
  }

  @Get(':id')
  @RequiresGrant('account', 'read')
  @ApiOperation({ operationId: 'getAccount', summary: 'One account with its balance' })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: AccountIdParamsDto,
  ): Promise<AccountResponseDto> {
    return toAccountResponse(await this.getAccount.execute(user, params.id));
  }

  @Patch(':id')
  @RequiresGrant('account', 'update')
  @ApiOperation({
    operationId: 'updateAccount',
    summary: 'Edit an account (the currency is locked once it has movements)',
  })
  @ApiBody({ type: UpdateAccountDto })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: AccountIdParamsDto,
    @Body() body: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    return toAccountResponse(await this.updateAccount.execute(user, params.id, body));
  }

  @Get(':id/ledger')
  @RequiresGrant('account', 'read')
  @ApiOperation({
    operationId: 'getAccountLedger',
    summary: 'Ledger of an account with the running balance of every entry',
  })
  @ApiOkResponse({ type: AccountLedgerResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async ledger(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: AccountIdParamsDto,
    @Query() query: AccountLedgerQueryDto,
  ): Promise<AccountLedgerResponseDto> {
    const page = await this.getLedger.execute(user, params.id, query);
    return { ...page, items: page.items.map(toLedgerRowResponse) };
  }

  @Get(':id/balance')
  @RequiresGrant('account', 'read')
  @ApiOperation({
    operationId: 'getAccountBalance',
    summary: 'Balance of an account at the end of a date (today when omitted)',
  })
  @ApiOkResponse({ type: AccountBalanceResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async balance(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: AccountIdParamsDto,
    @Query() query: AccountBalanceQueryDto,
  ): Promise<AccountBalanceResponseDto> {
    return toBalanceResponse(
      await this.getBalance.execute(user, params.id, query.at ? { at: query.at } : {}),
    );
  }

  @Post(':id/reconcile')
  @HttpCode(200)
  @RequiresGrant('account', 'update')
  @ApiOperation({
    operationId: 'reconcileAccount',
    summary: 'Record a reconciliation and suggest the AJUSTE that closes the difference',
  })
  @ApiBody({ type: ReconcileAccountDto })
  @ApiOkResponse({ type: ReconciliationResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async reconcile(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: AccountIdParamsDto,
    @Body() body: ReconcileAccountDto,
  ): Promise<ReconciliationResponseDto> {
    return toReconciliationResponse(await this.reconcileAccount.execute(user, params.id, body));
  }

  @Post(':id/movements')
  @RequiresGrant('account', 'create')
  @ApiOperation({
    operationId: 'createAccountMovement',
    summary: 'Record a contribution, a withdrawal or a signed adjustment',
  })
  @ApiBody({ type: CreateMovementDto })
  @ApiCreatedResponse({ type: MovementResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async movement(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: AccountIdParamsDto,
    @Body() body: CreateMovementDto,
  ): Promise<MovementResponseDto> {
    return toMovementResponse(
      await this.createMovement.execute(user, { ...body, accountId: params.id }),
    );
  }
}

/** Transfers between company accounts (HU-16). */
@ApiTags('accounts')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly createTransfer: CreateTransfer) {}

  @Post()
  @RequiresGrant('account', 'create')
  @ApiOperation({
    operationId: 'createTransfer',
    summary: 'Transfer between two accounts, each side in its own currency',
  })
  @ApiBody({ type: CreateTransferDto })
  @ApiCreatedResponse({ type: TransferResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreateTransferDto,
  ): Promise<TransferResponseDto> {
    return toTransferResponse(await this.createTransfer.execute(user, body));
  }
}
