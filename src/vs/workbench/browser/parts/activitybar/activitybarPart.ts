/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/activitybarpart';
import nls = require('vs/nls');
import { TPromise } from 'vs/base/common/winjs.base';
import { illegalArgument } from 'vs/base/common/errors';
import { Builder, $, Dimension } from 'vs/base/browser/builder';
import { Action } from 'vs/base/common/actions';
import { ActionsOrientation, ActionBar, Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { GlobalActivityExtensions, IGlobalActivityRegistry } from 'vs/workbench/common/activity';
import { Registry } from 'vs/platform/registry/common/platform';
import { Part } from 'vs/workbench/browser/part';
import { ToggleViewletPinnedAction, GlobalActivityActionItem, GlobalActivityAction, ViewletActivityAction, ToggleViewletAction } from 'vs/workbench/browser/parts/activitybar/activitybarActions';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IActivityBarService, IBadge } from 'vs/workbench/services/activity/common/activityBarService';
import { IPartService, Position as SideBarPosition } from 'vs/workbench/services/part/common/partService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionService } from 'vs/platform/extensions/common/extensions';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { dispose, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ToggleActivityBarVisibilityAction } from 'vs/workbench/browser/actions/toggleActivityBarVisibility';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ACTIVITY_BAR_BACKGROUND, ACTIVITY_BAR_BORDER } from 'vs/workbench/common/theme';
import { contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { CompositeBar } from 'vs/workbench/browser/parts/compositebar/compositeBar';

export class ActivitybarPart extends Part implements IActivityBarService {

	private static readonly ACTIVITY_ACTION_HEIGHT = 50;
	private static readonly PINNED_VIEWLETS = 'workbench.activity.pinnedViewlets';

	public _serviceBrand: any;

	private dimension: Dimension;

	private globalActionBar: ActionBar;
	private globalActivityIdToActions: { [globalActivityId: string]: GlobalActivityAction; };

	private compositeBar: CompositeBar;

	constructor(
		id: string,
		@IViewletService private viewletService: IViewletService,
		@IExtensionService private extensionService: IExtensionService,
		@IStorageService private storageService: IStorageService,
		@IContextMenuService private contextMenuService: IContextMenuService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IPartService private partService: IPartService,
		@IThemeService themeService: IThemeService
	) {
		super(id, { hasTitle: false }, themeService);

		this.globalActivityIdToActions = Object.create(null);
		this.compositeBar = this.instantiationService.createInstance(CompositeBar, {
			label: 'icon',
			storageId: ActivitybarPart.PINNED_VIEWLETS,
			orientation: ActionsOrientation.VERTICAL,
			composites: this.viewletService.getViewlets(),
			getCompositeSize: (compositeId: string) => ActivitybarPart.ACTIVITY_ACTION_HEIGHT,
			openComposite: (compositeId: string) => this.viewletService.openViewlet(compositeId, true),
			getActivityAction: (compositeId: string) => this.instantiationService.createInstance(ViewletActivityAction, this.viewletService.getViewlet(compositeId)),
			getCompositePinnedAction: (compositeId: string) => this.instantiationService.createInstance(ToggleViewletPinnedAction, this.viewletService.getViewlet(compositeId)),
			getOnCompositeClickAction: (compositeId: string) => this.instantiationService.createInstance(ToggleViewletAction, this.viewletService.getViewlet(compositeId)),
			getDefaultCompositeId: () => this.viewletService.getDefaultViewletId(),
			hidePart: () => this.partService.setSideBarHidden(true)
		});
		this.registerListeners();
	}

	private registerListeners(): void {

		// Activate viewlet action on opening of a viewlet
		this.toUnbind.push(this.viewletService.onDidViewletOpen(viewlet => this.compositeBar.activateComposite(viewlet.getId())));

		// Deactivate viewlet action on close
		this.toUnbind.push(this.viewletService.onDidViewletClose(viewlet => this.compositeBar.deactivateComposite(viewlet.getId())));
		this.toUnbind.push(this.compositeBar.onDidContextMenu(e => this.showContextMenu(e)));
	}

	public showActivity(viewletOrActionId: string, badge: IBadge, clazz?: string): IDisposable {
		if (this.viewletService.getViewlet(viewletOrActionId)) {
			return this.compositeBar.showActivity(viewletOrActionId, badge, clazz);
		}

		return this.showGlobalActivity(viewletOrActionId, badge);
	}

	private showGlobalActivity(globalActivityId: string, badge: IBadge): IDisposable {
		if (!badge) {
			throw illegalArgument('badge');
		}

		const action = this.globalActivityIdToActions[globalActivityId];
		if (!action) {
			throw illegalArgument('globalActivityId');
		}

		action.setBadge(badge);

		return toDisposable(() => action.setBadge(undefined));
	}

	public createContentArea(parent: Builder): Builder {
		const $el = $(parent);
		const $result = $('.content').appendTo($el);

		// Top Actionbar with action items for each viewlet action
		this.compositeBar.create($('.viewlets').appendTo($result).getHTMLElement());

		// Top Actionbar with action items for each viewlet action
		this.createGlobalActivityActionBar($('.global-activity').appendTo($result).getHTMLElement());

		return $result;
	}

	public updateStyles(): void {
		super.updateStyles();

		// Part container
		const container = this.getContainer();
		const background = this.getColor(ACTIVITY_BAR_BACKGROUND);
		container.style('background-color', background);

		const borderColor = this.getColor(ACTIVITY_BAR_BORDER) || this.getColor(contrastBorder);
		const isPositionLeft = this.partService.getSideBarPosition() === SideBarPosition.LEFT;
		container.style('box-sizing', borderColor && isPositionLeft ? 'border-box' : null);
		container.style('border-right-width', borderColor && isPositionLeft ? '1px' : null);
		container.style('border-right-style', borderColor && isPositionLeft ? 'solid' : null);
		container.style('border-right-color', isPositionLeft ? borderColor : null);
		container.style('border-left-width', borderColor && !isPositionLeft ? '1px' : null);
		container.style('border-left-style', borderColor && !isPositionLeft ? 'solid' : null);
		container.style('border-left-color', !isPositionLeft ? borderColor : null);
	}

	private showContextMenu(e: MouseEvent): void {
		const event = new StandardMouseEvent(e);

		const actions: Action[] = this.viewletService.getViewlets().map(viewlet => this.instantiationService.createInstance(ToggleViewletPinnedAction, viewlet));
		actions.push(new Separator());
		actions.push(this.instantiationService.createInstance(ToggleActivityBarVisibilityAction, ToggleActivityBarVisibilityAction.ID, nls.localize('hideActivitBar', "Hide Activity Bar")));

		this.contextMenuService.showContextMenu({
			getAnchor: () => { return { x: event.posx, y: event.posy }; },
			getActions: () => TPromise.as(actions),
			onHide: () => dispose(actions)
		});
	}

	private createGlobalActivityActionBar(container: HTMLElement): void {
		const activityRegistry = Registry.as<IGlobalActivityRegistry>(GlobalActivityExtensions);
		const descriptors = activityRegistry.getActivities();
		const actions = descriptors
			.map(d => this.instantiationService.createInstance(d))
			.map(a => new GlobalActivityAction(a));

		this.globalActionBar = new ActionBar(container, {
			actionItemProvider: a => this.instantiationService.createInstance(GlobalActivityActionItem, a),
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: nls.localize('globalActions', "Global Actions"),
			animated: false
		});

		actions.forEach(a => {
			this.globalActivityIdToActions[a.id] = a;
			this.globalActionBar.push(a);
		});
	}

	public getPinned(): string[] {
		return this.viewletService.getViewlets().map(v => v.id).filter(id => this.compositeBar.isPinned(id));;
	}

	public unpin(viewletId: string): void {
		this.compositeBar.unpin(viewletId);
	}

	public isPinned(viewletId: string): boolean {
		return this.compositeBar.isPinned(viewletId);
	}

	public pin(viewletId: string, update = true): void {
		this.compositeBar.pin(viewletId, update);
	}

	public move(viewletId: string, toViewletId: string): void {
		this.compositeBar.move(viewletId, toViewletId);
	}

	/**
	 * Layout title, content and status area in the given dimension.
	 */
	public layout(dimension: Dimension): Dimension[] {

		// Pass to super
		const sizes = super.layout(dimension);

		this.dimension = sizes[1];

		let availableHeight = this.dimension.height;
		if (this.globalActionBar) {
			// adjust height for global actions showing
			availableHeight -= (this.globalActionBar.items.length * ActivitybarPart.ACTIVITY_ACTION_HEIGHT);
		}
		this.compositeBar.layout(new Dimension(dimension.width, availableHeight));

		return sizes;
	}

	public dispose(): void {
		if (this.compositeBar) {
			this.compositeBar.dispose();
			this.compositeBar = null;
		}

		if (this.globalActionBar) {
			this.globalActionBar.dispose();
			this.globalActionBar = null;
		}

		super.dispose();
	}

	public shutdown(): void {

		// Persist Hidden State
		this.compositeBar.store();

		// Pass to super
		super.shutdown();
	}
}
