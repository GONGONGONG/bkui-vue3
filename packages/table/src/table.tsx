/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台社区版 (BlueKing PaaS Community Edition) available.
 *
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 *
 * 蓝鲸智云PaaS平台社区版 (BlueKing PaaS Community Edition) is licensed under the MIT License.
 *
 * License for 蓝鲸智云PaaS平台社区版 (BlueKing PaaS Community Edition):
 *
 * ---------------------------------------------------
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
*/

import { computed, defineComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from 'vue';

import { classes, resolveClassName } from '@bkui-vue/shared';
import VirtualRender from '@bkui-vue/virtual-render';

import { Column, IColumnActive, tableProps } from './props';
import TableRender, { EVENTS } from './render';
import {
  isPercentPixOrNumber,
  observerResize,
  resolveActiveColumns,
  resolveColumnWidth,
  resolveNumberOrStringToPix,
  resolvePaginationOption,
  resolvePropBorderToClassStr,
} from './utils';

export default defineComponent({
  name: 'Table',
  props: tableProps,
  emits: ['columnPick', 'rowClick', 'rowDblClick', 'pageLimitChange', 'pageValueChange'],
  setup(props, ctx) {
    const activeCols = reactive(resolveActiveColumns(props));
    const colgroups = reactive(props.columns.map(col => ({ ...col, calcWidth: null })));
    const startIndex = ref(0);
    const endIndex = ref(0);
    let columnSortFn: any = null;

    // 当前分页缓存，用于支持内置前端分页，用户无需接收change事件来自行处理数据分割
    let pagination = reactive({ count: 0, limit: 10, current: 1 });
    pagination = resolvePaginationOption(props.pagination, pagination);

    /**
     * 重置当前分页开始位置 & 结束位置
     * 如果未启用分页，则开始位置为0，结束位置为 data.length
     * @returns
     */
    const resetStartEndIndex = () => {
      if (!props.pagination || props.remotePagination) {
        startIndex.value = 0;
        endIndex.value = props.data.length;
        return;
      }

      // 如果是前端分页
      startIndex.value = (pagination.current - 1) * pagination.limit;
      endIndex.value = pagination.current * pagination.limit;
    };

    resetStartEndIndex();

    let observerIns = null;
    const root = ref();
    const getActiveColumns = () => (props.columns || []).map((_column: Column, index: number) => ({
      index,
      active: activeCols.some((colIndex: number) => colIndex === index),
      _column,
    }));
    const reactiveProp = reactive({
      activeColumns: getActiveColumns(),
      scrollTranslateY: 0,
    });

    watch(() => [props.activeColumn, props.columns], () => {
      nextTick(() => {
        reactiveProp.activeColumns = getActiveColumns();
        const cols = resolveActiveColumns(props);
        reactiveProp.activeColumns.forEach((col: IColumnActive, index: number) => {
          Object.assign(col, {
            active: cols.some((colIndex: number) => colIndex === index),
          });
        });
      });
    }, { deep: true });

    const indexData = computed(() => props.data.map((item: any, index: number) => ({
      ...item,
      __$table_row_index: index + 1,
    })));

    /**
   * 当前页分页数据
   */
    const pageData = reactive([]);

    /**
    * 根据Pagination配置的改变重新计算startIndex & endIndex
    */
    watchEffect(() => {
      pagination = resolvePaginationOption(props.pagination, pagination);
      resetStartEndIndex();
      pageData.splice(0, pageData.length, ...indexData.value.slice(startIndex.value, endIndex.value));

      if (typeof columnSortFn === 'function') {
        pageData.sort(columnSortFn);
      }
    });

    const tableRender = new TableRender(props, ctx, reactiveProp, colgroups);

    /**
     * 监听Table 派发的相关事件
     */
    tableRender.on(EVENTS.ON_SORT_BY_CLICK, (args: any) => {
      const { sortFn } = args;
      columnSortFn = sortFn;
      pageData.sort(columnSortFn);
    });

    /** 表格外层容器样式 */
    const wrapperStyle = computed(() => ({
      // height: resolveNumberOrStringToPix(props.height),
      minHeight: resolveNumberOrStringToPix(props.minHeight, 'auto'),
    }));

    /**
     * 分页配置
     * 用于配置分页组件
     * pagination 为Prop传入配置
     * 方便兼容内置分页功能，此处需要单独处理count
     */
    const localPagination = computed(() => {
      if (!props.pagination) {
        return null;
      }

      return props.remotePagination ? pagination : { ...pagination, count: props.data.length };
    });

    /** 表格外层容器样式 */
    const contentStyle = computed(() => {
      const resolveHeight = resolveNumberOrStringToPix(props.height);
      const resolveHeadHeight = props.showHead ? resolveNumberOrStringToPix(props.headHeight) : '0';
      const isAutoHeight = !isPercentPixOrNumber(props.height);
      const resolveFooterHeight = props.pagination ? 40 : 0;
      const contentHeight = `calc(${resolveHeight} - ${resolveHeadHeight} - ${resolveFooterHeight}px - 2px)`;
      return {
        display: 'block',
        ...(isAutoHeight ? { maxHeight: contentHeight }
          : { height: contentHeight }),
      };
    });

    const tableClass = computed(() => (classes({
      [resolveClassName('table')]: true,
    }, resolvePropBorderToClassStr(props.border))));

    const headClass = classes({
      [resolveClassName('table-head')]: true,
    });

    const contentClass = classes({
      [resolveClassName('table-body')]: true,
    });

    const footerClass = classes({
      [resolveClassName('table-footer')]: true,
    });

    const handleScrollChanged = (args: any[]) => {
      const pagination = args[1];
      reactiveProp.scrollTranslateY = pagination.translateY;
    };

    onMounted(() => {
      observerIns = observerResize(root.value, () => {
        resolveColumnWidth(root.value, colgroups, 20);
      }, 60, true);

      observerIns.start();
    });

    onBeforeUnmount(() => {
      observerIns.stop();
      observerIns = null;
      tableRender.destroy();
    });

    ctx.expose({
      plugins: tableRender.plugins,
    });

    return () => <div class={tableClass.value} style={wrapperStyle.value} ref={root}>
      <div class={ headClass }>
        {
          tableRender.renderTableHeadSchema()
        }
      </div>
    <VirtualRender
      lineHeight={props.rowHeight}
      class={ contentClass }
      style={ contentStyle.value }
      list={pageData}
      onContentScroll={ handleScrollChanged }
      throttleDelay={0}
      enabled={props.virtualEnabled}>
        {
          {
            default: (scope: any) => tableRender.renderTableBodySchema(scope.data || props.data),
            afterContent: () => <div class={ resolveClassName('table-fixed') }></div>,
          }
        }
    </VirtualRender>
    <div class={ footerClass }>
      {
        props.pagination && tableRender.renderTableFooter(localPagination.value)
      }
    </div>
    </div>;
  },
});

